import type { Context } from 'hono';
import {
  selectKeyFromPool,
  markKeyCooldown,
  markKeySuccess,
  markKeyError,
  checkPoolBudget,
  recordPoolSpend,
} from './pool';
import { logRequestAsync } from './logger';
import { sanitizeErrorMessage } from '../crypto';
import type { VirtualKey } from '../db';

export interface JevRelayOptions {
  poolId?: string;
  virtualKey?: VirtualKey | null;
  endpoint: '/systemone' | '/decisions';
}

/**
 * Direct JSON proxy for TypeSafe Jev Decision Relay (/v1/systemone and /v1/decisions).
 */
export async function handleJevRelay(c: Context, options: JevRelayOptions) {
  const rawBody = await c.req.text();
  let parsedBody: any = {};
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return c.json({ error: { message: 'Invalid JSON body for Jev endpoint' } }, 400);
  }

  const poolId = options.poolId || 'default';
  const model = parsedBody.model || 'jev-engine';

  // 1. Check pool budget
  const poolBudget = checkPoolBudget(poolId);
  if (!poolBudget.allowed) {
    return c.json(
      {
        error: {
          message: poolBudget.reason || 'Inference pool budget limit reached',
          type: 'budget_exceeded_error',
          code: 429,
        },
      },
      429
    );
  }

  // 2. Enforce allowed_models if configured on virtual key
  if (options.virtualKey?.allowed_models) {
    try {
      const allowed = JSON.parse(options.virtualKey.allowed_models);
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes('*') && !allowed.includes(model)) {
        return c.json(
          {
            error: {
              message: `Model '${model}' is not allowed for this API key. Allowed models: ${allowed.join(', ')}`,
              type: 'permission_error',
              code: 'model_not_allowed',
            },
          },
          403
        );
      }
    } catch {}
  }

  const attemptedKeys = new Set<string>();
  let lastResponse: Response | null = null;
  let lastStatus = 500;
  let lastErrorMsg = 'No upstream keys available for Jev relay';

  while (true) {
    const selected = selectKeyFromPool(poolId, attemptedKeys, '*', 'decision');
    if (!selected) {
      const finalStatus = lastStatus === 429 ? 429 : (lastResponse ? (lastResponse.status as any) : 503);
      const errMsg = lastStatus === 429
        ? 'All Jev upstream providers are cooling down. Please retry shortly.'
        : sanitizeErrorMessage(lastErrorMsg);

      logRequestAsync({
        virtualKeyId: options.virtualKey?.id,
        upstreamKeyId: null,
        poolId,
        provider: 'none',
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        statusCode: finalStatus,
        errorMessage: errMsg,
        streamed: false,
        aborted: false,
        endpoint: `/v1${options.endpoint}`,
      });

      if (lastStatus === 429) {
        return c.json(
          {
            error: {
              message: errMsg,
              code: 429,
            },
          },
          429
        );
      }
      return c.json(
        {
          error: {
            message: errMsg,
            type: 'jev_relay_error',
          },
        },
        finalStatus
      );
    }

    attemptedKeys.add(selected.key.id);
    const startTime = Date.now();

    const baseUrl = selected.key.base_url.replace(/\/+$/, '');
    // If baseUrl already ends with /v1, use endpoint directly (/systemone); otherwise prepend /v1
    const upstreamUrl = baseUrl.endsWith('/v1')
      ? `${baseUrl}${options.endpoint}`
      : `${baseUrl}/v1${options.endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${selected.apiKey}`,
      'x-api-key': selected.apiKey,
      'Content-Type': 'application/json',
    };

    const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(120_000) : undefined;
    const fetchSignal = timeoutSignal && (AbortSignal as any).any
      ? (AbortSignal as any).any([c.req.raw.signal, timeoutSignal])
      : c.req.raw.signal;

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: fetchSignal,
      });

      lastResponse = upstreamRes;
      lastStatus = upstreamRes.status;

      if (upstreamRes.status === 429) {
        const retryAfter = upstreamRes.headers.get('retry-after');
        markKeyCooldown(selected.key, retryAfter);
        continue;
      }

      if ([502, 503, 504].includes(upstreamRes.status)) {
        markKeyError(selected.key.id, `Upstream server returned HTTP ${upstreamRes.status}`);
        continue;
      }

      if (upstreamRes.ok) {
        markKeySuccess(selected.key.id);
      }

      const latency = Date.now() - startTime;
      const resText = await upstreamRes.text();
      let resJson: any = null;
      try {
        resJson = JSON.parse(resText);
      } catch {}

      const totalTokens = (resJson?.usage?.total_tokens) || 0;
      if (totalTokens > 0) {
        recordPoolSpend(poolId, totalTokens, 0, (selected as any).routeId);
      }

      const responseHeaders = new Headers();
      responseHeaders.set('x-capy-key-id', selected.key.id);
      responseHeaders.set('x-capy-provider', selected.key.provider);
      responseHeaders.set('x-capy-latency-ms', latency.toString());

      logRequestAsync({
        virtualKeyId: options.virtualKey?.id,
        upstreamKeyId: selected.key.id,
        poolId,
        provider: selected.key.provider,
        model,
        promptTokens: resJson?.usage?.prompt_tokens || 0,
        completionTokens: resJson?.usage?.completion_tokens || 0,
        totalTokens,
        costUsd: 0,
        latencyMs: latency,
        statusCode: upstreamRes.status,
        errorMessage: upstreamRes.ok ? null : sanitizeErrorMessage(resJson?.error?.message || 'Upstream Jev error'),
        streamed: false,
        aborted: false,
        endpoint: `/v1${options.endpoint}`,
      });

      if (resJson && typeof resJson === 'object') {
        const shouldIncludeMetadata = options.virtualKey
          ? options.virtualKey.include_metadata !== 0 && (options.virtualKey.include_metadata as any) !== false
          : true;
        if (shouldIncludeMetadata) {
          resJson.capy_meta = {
            key_id: selected.key.id,
            provider: selected.key.provider,
            latency_ms: latency,
          };
        }
        return c.json(resJson, upstreamRes.status as any, Object.fromEntries(responseHeaders.entries()));
      }

      return new Response(sanitizeErrorMessage(resText), {
        status: upstreamRes.status,
        headers: responseHeaders,
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || c.req.raw.signal.aborted) {
        logRequestAsync({
          virtualKeyId: options.virtualKey?.id,
          upstreamKeyId: selected.key.id,
          poolId,
          provider: selected.key.provider,
          model,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startTime,
          statusCode: 499,
          errorMessage: 'Client disconnected',
          streamed: false,
          aborted: true,
          endpoint: `/v1${options.endpoint}`,
        });
        return c.text('Client disconnected', 499);
      }
      lastErrorMsg = sanitizeErrorMessage(err.message || 'Jev relay fetch error');
      markKeyError(selected.key.id, lastErrorMsg);
    }
  }
}
