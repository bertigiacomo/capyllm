import type { Context } from 'hono';
import {
  selectKeyFromPools,
  markKeyCooldown,
  markKeySuccess,
  markKeyError,
  checkPoolBudget,
  recordPoolSpend,
  transformPayloadForUpstream,
  diagnosePoolUnavailable,
  matchModelPattern,
  resolveModelForUpstream,
  stripProviderPrefix,
} from './pool';
import { calculateCost } from './pricing';
import { logRequestAsync } from './logger';
import { sanitizeErrorMessage } from '../crypto';
import { adaptPayloadForTargetModel, type AdaptationTrace } from './model_capabilities';
import type { VirtualKey } from '../db';

/**
 * Estimates prompt/input token count from incoming payload when upstream doesn't return usage.
 * Uses ~3.8 chars per token plus 4 message framing tokens.
 */
function estimateTokensFromPayload(payload: any): number {
  if (!payload || typeof payload !== 'object') return 0;
  let text = '';
  if (Array.isArray(payload.messages)) {
    for (const m of payload.messages) {
      if (m.role) text += m.role + ' ';
      if (typeof m.content === 'string') {
        text += m.content + ' ';
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part && typeof part.text === 'string') text += part.text + ' ';
        }
      }
    }
  } else if (typeof payload.input === 'string') {
    text += payload.input;
  } else if (Array.isArray(payload.input)) {
    text += payload.input.map((i: any) => (typeof i === 'string' ? i : JSON.stringify(i))).join(' ');
  } else if (typeof payload.prompt === 'string') {
    text += payload.prompt;
  } else if (Array.isArray(payload.prompt)) {
    text += payload.prompt.join(' ');
  }

  const chars = text.trim().length;
  if (chars === 0) return 1;
  return Math.max(1, Math.ceil(chars / 3.8) + 4);
}

/**
 * Extracts completion text from non-streaming JSON responses for fallback token estimation.
 */
function extractCompletionText(resJson: any): string {
  if (!resJson || typeof resJson !== 'object') return '';
  if (resJson.choices?.[0]?.message?.content) {
    const c = resJson.choices[0].message.content;
    return typeof c === 'string' ? c : JSON.stringify(c);
  }
  if (resJson.response?.output_text) return String(resJson.response.output_text);
  if (resJson.output_text) return String(resJson.output_text);
  if (resJson.content?.[0]?.text) return String(resJson.content[0].text);
  return '';
}

export interface RelayOptions {
  poolId?: string;
  poolIds?: string[];
  virtualKey?: VirtualKey | null;
  endpoint?: string; // '/chat/completions', '/responses', '/embeddings', etc.
}

export interface FailoverRecord {
  provider: string;
  upstream_key_id: string;
  upstream_key_name: string;
  model: string;
  status_code: number;
  reason: string;
  latency_ms: number;
}

export async function handleOpenAiRelay(c: Context, options: RelayOptions = {}) {
  const endpoint = options.endpoint || '/chat/completions';
  const rawBody = await c.req.text();

  let parsedBody: any = {};
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return c.json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const model = parsedBody.model || 'unknown';
  const isStreaming = Boolean(parsedBody.stream);
  const poolIds = options.poolIds && options.poolIds.length > 0
    ? options.poolIds
    : [options.poolId || options.virtualKey?.pool_id || 'default'];
  const poolId = poolIds[0] || 'default';

  // 1. Enforce pool-level budget before attempting upstream
  const anyPoolAllowed = poolIds.some((p) => checkPoolBudget(p).allowed);
  if (!anyPoolAllowed) {
    const poolBudget = checkPoolBudget(poolId);
    return c.json(
      {
        error: {
          message: poolBudget.reason,
          type: 'budget_exceeded_error',
          code: 'pool_budget_exhausted',
        },
      },
      429
    );
  }

  // 2. Enforce allowed_models if configured on virtual key
  if (options.virtualKey?.allowed_models) {
    try {
      const allowed = JSON.parse(options.virtualKey.allowed_models);
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes('*')) {
        const isAllowed = allowed.some((a: string) => matchModelPattern(a, model));
        if (!isAllowed) {
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
      }
    } catch {}
  }

  // For streaming, inject stream_options to get usage without tokenizer
  if (isStreaming) {
    parsedBody.stream_options = {
      ...(parsedBody.stream_options || {}),
      include_usage: true,
    };
  }

  // Determine required API schema from endpoint
  let requiredSchema = 'chat_completions';
  if (endpoint.includes('/responses')) {
    requiredSchema = 'responses';
  } else if (endpoint.includes('/embeddings')) {
    requiredSchema = 'embeddings';
  } else if (endpoint.includes('/decision') || endpoint.includes('/systemone')) {
    requiredSchema = 'decision';
  }

  const attemptedKeys = new Set<string>();
  const failoverHistory: FailoverRecord[] = [];
  let lastResponse: Response | null = null;
  let lastStatus = 500;
  let lastErrorMsg = 'No upstream keys available in this pool';

  while (true) {
    const selected = selectKeyFromPools(poolIds, attemptedKeys, model, requiredSchema);
    if (!selected) {
      const diag = diagnosePoolUnavailable(poolIds, model, requiredSchema);
      const isRateLimited = lastStatus === 429 || diag.isCooldown;
      const finalStatus = isRateLimited ? 429 : (lastResponse ? (lastResponse.status as any) : (attemptedKeys.size > 0 ? lastStatus : 503));
      const errMsg = isRateLimited
        ? 'All upstream providers in this pool are currently rate limited / cooling down. Please retry shortly.'
        : sanitizeErrorMessage(attemptedKeys.size > 0 ? lastErrorMsg : diag.reason);

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
        streamed: isStreaming,
        aborted: false,
        endpoint,
      });

      const shouldIncludeMetadata = options.virtualKey
        ? options.virtualKey.include_metadata !== 0 && (options.virtualKey.include_metadata as any) !== false
        : true;

      if (isRateLimited) {
        if (diag.retryAfterSeconds > 0) {
          c.header('Retry-After', diag.retryAfterSeconds.toString());
        }
        return c.json(
          {
            error: {
              message: errMsg,
              type: 'rate_limit_error',
              code: 429,
            },
            ...(shouldIncludeMetadata && failoverHistory.length > 0 ? { failover_history: failoverHistory } : {}),
          },
          429
        );
      }
      return c.json(
        {
          error: {
            message: errMsg,
            type: 'capy_relay_error',
            code: finalStatus,
          },
          ...(shouldIncludeMetadata && failoverHistory.length > 0 ? { failover_history: failoverHistory } : {}),
        },
        finalStatus
      );
    }

    attemptedKeys.add(selected.key.id);
    const activePoolId = selected.poolId || poolId;
    const startTime = Date.now();
    const effectiveModel = resolveModelForUpstream(selected.targetModel || model, selected.key.provider, selected.key.discovered_models);
    const reasoningPolicy = selected.reasoningPolicy || 'inherit';

    // Adapt request body based on target model capabilities & reasoning policy, tracking transformations
    const traceCollector: { trace?: AdaptationTrace } = {};
    const requestPayload = adaptPayloadForTargetModel(parsedBody, effectiveModel, selected.key.provider, reasoningPolicy, traceCollector);

    // Ensure usage chunk is requested in streams for OpenAI/OpenRouter if not explicitly set
    if (isStreaming && (selected.key.provider === 'openai' || selected.key.provider === 'openrouter') && requestPayload.stream_options === undefined) {
      requestPayload.stream_options = { include_usage: true };
    }

    // Transform body and extract custom headers from key schema configuration
    const { body: preparedBody, headers: customHeaders } = transformPayloadForUpstream(requestPayload, selected.key);

    // Construct upstream URL
    const baseUrl = selected.key.base_url.replace(/\/+$/, '');
    const upstreamUrl = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${selected.apiKey}`,
      'x-api-key': selected.apiKey,
      'x-goog-api-key': selected.apiKey,
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(120_000) : undefined;
    const fetchSignal = timeoutSignal && (AbortSignal as any).any
      ? (AbortSignal as any).any([c.req.raw.signal, timeoutSignal])
      : c.req.raw.signal;

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: preparedBody,
        signal: fetchSignal,
      });

      lastResponse = upstreamRes;
      lastStatus = upstreamRes.status;

      // Handle HTTP 429 (Rate Limit): trigger cooldown, log attempt, record failover and retry next key
      if (upstreamRes.status === 429) {
        const attemptLatency = Date.now() - startTime;
        const errText = await upstreamRes.text().catch(() => '');
        let errReason = sanitizeErrorMessage(errText || 'Rate limit exceeded (HTTP 429)');
        try {
          const p = JSON.parse(errText);
          if (typeof p.error === 'string') errReason = sanitizeErrorMessage(p.error);
          else if (p.error?.message) errReason = sanitizeErrorMessage(p.error.message);
          else if (p.message) errReason = sanitizeErrorMessage(p.message);
        } catch {}

        logRequestAsync({
          virtualKeyId: options.virtualKey?.id,
          upstreamKeyId: selected.key.id,
          poolId: activePoolId,
          provider: selected.key.provider,
          model: effectiveModel,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: attemptLatency,
          statusCode: 429,
          errorMessage: errReason,
          streamed: isStreaming,
          aborted: false,
          endpoint,
        });

        failoverHistory.push({
          provider: selected.key.provider,
          upstream_key_id: selected.key.id,
          upstream_key_name: selected.key.name,
          model: effectiveModel,
          status_code: 429,
          reason: errReason,
          latency_ms: attemptLatency,
        });

        lastErrorMsg = errReason;
        const retryAfter = upstreamRes.headers.get('retry-after');
        markKeyCooldown(selected.key, retryAfter);
        continue;
      }

      // Handle upstream gateway errors (502, 503, 504): log attempt, record failover and fail over
      if ([502, 503, 504].includes(upstreamRes.status)) {
        const attemptLatency = Date.now() - startTime;
        const errText = await upstreamRes.text().catch(() => '');
        let errReason = sanitizeErrorMessage(errText || `Upstream gateway error (HTTP ${upstreamRes.status})`);
        try {
          const p = JSON.parse(errText);
          if (typeof p.error === 'string') errReason = sanitizeErrorMessage(p.error);
          else if (p.error?.message) errReason = sanitizeErrorMessage(p.error.message);
          else if (p.message) errReason = sanitizeErrorMessage(p.message);
        } catch {}

        logRequestAsync({
          virtualKeyId: options.virtualKey?.id,
          upstreamKeyId: selected.key.id,
          poolId: activePoolId,
          provider: selected.key.provider,
          model: effectiveModel,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: attemptLatency,
          statusCode: upstreamRes.status,
          errorMessage: errReason,
          streamed: isStreaming,
          aborted: false,
          endpoint,
        });

        failoverHistory.push({
          provider: selected.key.provider,
          upstream_key_id: selected.key.id,
          upstream_key_name: selected.key.name,
          model: effectiveModel,
          status_code: upstreamRes.status,
          reason: errReason,
          latency_ms: attemptLatency,
        });

        lastErrorMsg = errReason;
        markKeyError(selected.key.id, `Upstream server returned HTTP ${upstreamRes.status}`);
        continue;
      }

      // Mark key as successful if 2xx
      if (upstreamRes.ok) {
        markKeySuccess(selected.key.id);
      }

      const connectionLatency = Date.now() - startTime;
      const responseHeaders = new Headers();
      // Transparent HTTP headers for app observability
      responseHeaders.set('x-capyllm-upstream-provider', selected.key.provider);
      responseHeaders.set('x-capyllm-upstream-key', selected.key.name);
      responseHeaders.set('x-capyllm-pool', activePoolId);
      responseHeaders.set('x-capyllm-latency-ms', connectionLatency.toString());
      responseHeaders.set('x-capy-key-id', selected.key.id);
      responseHeaders.set('x-capy-provider', selected.key.provider);
      responseHeaders.set('x-capy-latency-ms', connectionLatency.toString());
      if (failoverHistory.length > 0) {
        responseHeaders.set('x-capyllm-failover', 'true');
        responseHeaders.set('x-capyllm-failover-count', failoverHistory.length.toString());
      }

      // Handle Streaming: Only stream 2xx SSE responses.
      if (isStreaming && upstreamRes.ok && upstreamRes.body) {
        let ttftMs: number | null = null;
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;
        let reasoningTokens = 0;
        let streamedChars = 0;
        let streamedReasoningChars = 0;
        let streamedOutputText = '';
        let hasLogged = false;
        let resolvedModel = effectiveModel;

        const onAbort = () => {
          if (upstreamRes.body) {
            try { upstreamRes.body.cancel(); } catch {}
          }
          if (totalTokens === 0) {
            if (promptTokens === 0) promptTokens = estimateTokensFromPayload(parsedBody);
            completionTokens = Math.max(1, Math.ceil(streamedChars > 0 ? streamedChars / 3.8 : (buffer.length / 4)));
            totalTokens = promptTokens + completionTokens;
          }
          finishLogOnce(true, 499, 'Client disconnected');
        };

        const finishLogOnce = (aborted: boolean, statusCode: number, errMsg?: string) => {
          if (hasLogged) return;
          hasLogged = true;
          try {
            c.req.raw.signal.removeEventListener('abort', onAbort);
          } catch {}

          if (promptTokens === 0) {
            promptTokens = estimateTokensFromPayload(parsedBody);
          }
          if (completionTokens === 0) {
            if (streamedChars > 0) {
              completionTokens = Math.max(1, Math.ceil(streamedChars / 3.8));
            } else if (statusCode >= 200 && statusCode < 300) {
              completionTokens = 1;
            }
          }
          if (reasoningTokens === 0 && streamedReasoningChars > 0) {
            reasoningTokens = Math.max(1, Math.ceil(streamedReasoningChars / 3.8));
          }
          if (totalTokens === 0) {
            totalTokens = promptTokens + completionTokens;
          }

          const latency = Date.now() - startTime;
          const cost = calculateCost(resolvedModel, promptTokens, completionTokens, {
            provider: selected.key.provider,
            upstreamKeyId: selected.key.id,
            capyKeyId: options.virtualKey?.id,
          });

          // Record spend on pool and route
          recordPoolSpend(activePoolId, totalTokens, cost, selected.routeId);

          if (traceCollector.trace) {
            if (failoverHistory.length > 0) {
              traceCollector.trace.failover_history = failoverHistory;
            }
            if (reasoningTokens > 0) {
              traceCollector.trace.reasoning_tokens = reasoningTokens;
            }
            if (streamedOutputText) {
              traceCollector.trace.output_preview = streamedOutputText.slice(0, 1500);
            }
          }
          const adaptationMeta = traceCollector.trace ? JSON.stringify(traceCollector.trace) : null;

          logRequestAsync({
            virtualKeyId: options.virtualKey?.id,
            upstreamKeyId: selected.key.id,
            poolId: activePoolId,
            provider: selected.key.provider,
            model: resolvedModel,
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd: cost,
            latencyMs: latency,
            ttftMs,
            statusCode,
            errorMessage: errMsg ? sanitizeErrorMessage(errMsg) : undefined,
            streamed: true,
            aborted,
            endpoint,
            adaptationMeta,
          });
        };

        c.req.raw.signal.addEventListener('abort', onAbort);

        let buffer = '';
        const decoder = new TextDecoder();

        const transformStream = new TransformStream({
          transform(chunk, controller) {
            if (ttftMs === null) {
              ttftMs = Date.now() - startTime;
            }
            controller.enqueue(chunk);

            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim();
                if (dataStr && dataStr !== '[DONE]') {
                  try {
                    const sseJson = JSON.parse(dataStr);
                    if (sseJson.model && typeof sseJson.model === 'string' && sseJson.model) {
                      resolvedModel = sseJson.model;
                    }
                    const usageObj = sseJson.usage || sseJson.response?.usage || sseJson.item?.usage;
                    if (usageObj) {
                      promptTokens = usageObj.prompt_tokens ?? usageObj.input_tokens ?? promptTokens;
                      completionTokens = usageObj.completion_tokens ?? usageObj.output_tokens ?? completionTokens;
                      totalTokens = usageObj.total_tokens ?? (promptTokens + completionTokens);
                      if (usageObj.completion_tokens_details?.reasoning_tokens !== undefined) {
                        reasoningTokens = usageObj.completion_tokens_details.reasoning_tokens;
                      } else if (usageObj.reasoning_tokens !== undefined) {
                        reasoningTokens = usageObj.reasoning_tokens;
                      }
                    }
                    if (sseJson.choices?.[0]?.delta?.content && typeof sseJson.choices[0].delta.content === 'string') {
                      streamedChars += sseJson.choices[0].delta.content.length;
                      if (streamedOutputText.length < 2000) streamedOutputText += sseJson.choices[0].delta.content;
                    }
                    if (sseJson.choices?.[0]?.delta?.reasoning_content && typeof sseJson.choices[0].delta.reasoning_content === 'string') {
                      streamedReasoningChars += sseJson.choices[0].delta.reasoning_content.length;
                    }
                    if (sseJson.delta?.text && typeof sseJson.delta.text === 'string') {
                      streamedChars += sseJson.delta.text.length;
                      if (streamedOutputText.length < 2000) streamedOutputText += sseJson.delta.text;
                    }
                    if (sseJson.output_text_delta && typeof sseJson.output_text_delta === 'string') {
                      streamedChars += sseJson.output_text_delta.length;
                      if (streamedOutputText.length < 2000) streamedOutputText += sseJson.output_text_delta;
                    }
                  } catch {}
                }
              }
            }
          },
          flush() {
            if (buffer.trim()) {
              const line = buffer.trim();
              if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr && dataStr !== '[DONE]') {
                  try {
                    const sseJson = JSON.parse(dataStr);
                    if (sseJson.model && typeof sseJson.model === 'string' && sseJson.model) {
                      resolvedModel = sseJson.model;
                    }
                    const usageObj = sseJson.usage || sseJson.response?.usage || sseJson.item?.usage;
                    if (usageObj) {
                      promptTokens = usageObj.prompt_tokens ?? usageObj.input_tokens ?? promptTokens;
                      completionTokens = usageObj.completion_tokens ?? usageObj.output_tokens ?? completionTokens;
                      totalTokens = usageObj.total_tokens ?? (promptTokens + completionTokens);
                      if (usageObj.completion_tokens_details?.reasoning_tokens !== undefined) {
                        reasoningTokens = usageObj.completion_tokens_details.reasoning_tokens;
                      } else if (usageObj.reasoning_tokens !== undefined) {
                        reasoningTokens = usageObj.reasoning_tokens;
                      }
                    }
                    if (sseJson.choices?.[0]?.delta?.content && typeof sseJson.choices[0].delta.content === 'string') {
                      streamedChars += sseJson.choices[0].delta.content.length;
                      if (streamedOutputText.length < 2000) streamedOutputText += sseJson.choices[0].delta.content;
                    }
                    if (sseJson.choices?.[0]?.delta?.reasoning_content && typeof sseJson.choices[0].delta.reasoning_content === 'string') {
                      streamedReasoningChars += sseJson.choices[0].delta.reasoning_content.length;
                    }
                    if (sseJson.delta?.text && typeof sseJson.delta.text === 'string') {
                      streamedChars += sseJson.delta.text.length;
                      if (streamedOutputText.length < 2000) streamedOutputText += sseJson.delta.text;
                    }
                    if (sseJson.output_text_delta && typeof sseJson.output_text_delta === 'string') {
                      streamedChars += sseJson.output_text_delta.length;
                      if (streamedOutputText.length < 2000) streamedOutputText += sseJson.output_text_delta;
                    }
                  } catch {}
                }
              }
            }
            finishLogOnce(false, upstreamRes.status);
          },
          cancel(reason) {
            finishLogOnce(true, upstreamRes.status, `Stream cancelled: ${reason}`);
          },
        });

        responseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
        responseHeaders.set('Cache-Control', 'no-cache');
        responseHeaders.set('Connection', 'keep-alive');

        return new Response(upstreamRes.body.pipeThrough(transformStream), {
          status: upstreamRes.status,
          headers: responseHeaders,
        });
      }

      // Handle Non-Streaming & Non-2xx Streaming Errors
      const resText = await upstreamRes.text();
      const latency = Date.now() - startTime;
      responseHeaders.set('x-capyllm-latency-ms', latency.toString());
      responseHeaders.set('x-capy-latency-ms', latency.toString());

      let resJson: any = null;
      try {
        resJson = JSON.parse(resText);
      } catch {}

      // Resolve the actual model returned by upstream (e.g. OpenRouter Free returns concrete model)
      const resolvedModel = (resJson && typeof resJson.model === 'string' && resJson.model) ? resJson.model : effectiveModel;

      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      if (resJson && typeof resJson === 'object') {
        const usageObj = resJson.usage || resJson.response?.usage || resJson.item?.usage;
        let reasoningTokens = 0;
        if (usageObj) {
          promptTokens = usageObj.prompt_tokens ?? usageObj.input_tokens ?? 0;
          completionTokens = usageObj.completion_tokens ?? usageObj.output_tokens ?? 0;
          totalTokens = usageObj.total_tokens ?? (promptTokens + completionTokens);
          if (usageObj.completion_tokens_details?.reasoning_tokens !== undefined) {
            reasoningTokens = usageObj.completion_tokens_details.reasoning_tokens;
          } else if (usageObj.reasoning_tokens !== undefined) {
            reasoningTokens = usageObj.reasoning_tokens;
          }
        }

        const outText = extractCompletionText(resJson);
        if (totalTokens === 0 && upstreamRes.ok) {
          promptTokens = estimateTokensFromPayload(parsedBody);
          completionTokens = Math.max(1, Math.ceil((outText.length || 4) / 3.8));
          totalTokens = promptTokens + completionTokens;
        }

        const cost = calculateCost(resolvedModel, promptTokens, completionTokens, {
          provider: selected.key.provider,
          upstreamKeyId: selected.key.id,
          capyKeyId: options.virtualKey?.id,
        });

        // Record spend on pool and route
        recordPoolSpend(activePoolId, totalTokens, cost, selected.routeId);

        if (traceCollector.trace) {
          if (failoverHistory.length > 0) {
            traceCollector.trace.failover_history = failoverHistory;
          }
          if (reasoningTokens > 0) {
            traceCollector.trace.reasoning_tokens = reasoningTokens;
          }
          if (outText) {
            traceCollector.trace.output_preview = outText.slice(0, 1500);
          }
        }
        const adaptationMeta = traceCollector.trace ? JSON.stringify(traceCollector.trace) : null;

        // Inject capy_meta into the JSON response only if virtualKey allows it (default: true)
        const shouldIncludeMetadata = options.virtualKey
          ? options.virtualKey.include_metadata !== 0 && (options.virtualKey.include_metadata as any) !== false
          : true;
        if (shouldIncludeMetadata) {
          resJson.capy_meta = {
            requested_model: model,
            resolved_model: resolvedModel,
            upstream_provider: selected.key.provider,
            upstream_key: selected.key.name,
            pool: activePoolId,
            key_id: selected.key.id,
            provider: selected.key.provider,
            latency_ms: latency,
            cost_usd: cost,
            failover: failoverHistory.length > 0,
            ...(failoverHistory.length > 0 ? { failover_history: failoverHistory } : {}),
            ...(traceCollector.trace ? { adaptation: traceCollector.trace } : {}),
          };
        }

        if (resJson.error) {
          if (typeof resJson.error === 'string') {
            resJson.error = { message: sanitizeErrorMessage(resJson.error) };
          } else if (resJson.error.message) {
            resJson.error.message = sanitizeErrorMessage(resJson.error.message);
          }
        }

        logRequestAsync({
          virtualKeyId: options.virtualKey?.id,
          upstreamKeyId: selected.key.id,
          poolId: activePoolId,
          provider: selected.key.provider,
          model: resolvedModel,
          promptTokens,
          completionTokens,
          totalTokens,
          costUsd: cost,
          latencyMs: latency,
          ttftMs: null,
          statusCode: upstreamRes.status,
          errorMessage: upstreamRes.ok ? undefined : sanitizeErrorMessage(resText),
          streamed: false,
          aborted: false,
          endpoint,
          adaptationMeta,
        });

        return c.json(resJson, upstreamRes.status as any, Object.fromEntries(responseHeaders.entries()));
      }

      // Raw non-JSON text response sanitized into standard OpenAI error structure for errors
      const sanitizedText = sanitizeErrorMessage(resText);
      logRequestAsync({
        virtualKeyId: options.virtualKey?.id,
        upstreamKeyId: selected.key.id,
        poolId: activePoolId,
        provider: selected.key.provider,
        model: resolvedModel,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: latency,
        ttftMs: null,
        statusCode: upstreamRes.status,
        errorMessage: upstreamRes.ok ? undefined : sanitizedText,
        streamed: false,
        aborted: false,
        endpoint,
      });

      if (!upstreamRes.ok) {
        const shouldIncludeMetadata = options.virtualKey
          ? options.virtualKey.include_metadata !== 0 && (options.virtualKey.include_metadata as any) !== false
          : true;
        const errorBody: any = {
          error: {
            message: sanitizedText || `Upstream provider returned HTTP ${upstreamRes.status}`,
            type: 'upstream_error',
            code: upstreamRes.status,
          },
          ...(shouldIncludeMetadata && failoverHistory.length > 0 ? { failover_history: failoverHistory } : {}),
        };
        return c.json(
          errorBody,
          upstreamRes.status as any,
          Object.fromEntries(responseHeaders.entries())
        );
      }

      return new Response(sanitizedText, {
        status: upstreamRes.status,
        headers: responseHeaders,
      });
    } catch (err: any) {
      if (c.req.raw.signal.aborted) {
        logRequestAsync({
          virtualKeyId: options.virtualKey?.id,
          upstreamKeyId: selected.key.id,
          poolId: activePoolId,
          provider: selected.key.provider,
          model,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startTime,
          statusCode: 499,
          errorMessage: 'Client disconnected',
          streamed: isStreaming,
          aborted: true,
          endpoint,
        });
        return c.text('Client disconnected', 499);
      }
      lastErrorMsg = sanitizeErrorMessage(
        err?.name === 'TimeoutError' || (err?.name === 'AbortError' && !c.req.raw.signal.aborted)
          ? 'Upstream request timed out (120s)'
          : (err?.message || 'Upstream fetch network error')
      );
      const attemptLatency = Date.now() - startTime;
      logRequestAsync({
        virtualKeyId: options.virtualKey?.id,
        upstreamKeyId: selected.key.id,
        poolId: activePoolId,
        provider: selected.key.provider,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: attemptLatency,
        statusCode: 502,
        errorMessage: lastErrorMsg,
        streamed: isStreaming,
        aborted: false,
        endpoint,
      });

      failoverHistory.push({
        provider: selected.key.provider,
        upstream_key_id: selected.key.id,
        upstream_key_name: selected.key.name,
        model,
        status_code: 502,
        reason: lastErrorMsg,
        latency_ms: attemptLatency,
      });

      markKeyError(selected.key.id, lastErrorMsg);
      lastStatus = 502;
      continue;
    }
  }
}
