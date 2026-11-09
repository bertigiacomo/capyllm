import { getDatabase, type VirtualKey, type UpstreamKey } from '../db';
import {
  notifyBudgetWarningAsync,
  notifyBudgetExceededAsync,
  notifyUpstreamKeyDailyLimitReachedAsync,
} from './telegram';
import crypto from 'node:crypto';

export interface LogPayload {
  virtualKeyId?: string | null;
  upstreamKeyId?: string | null;
  poolId?: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  ttftMs?: number | null;
  statusCode: number;
  errorMessage?: string | null;
  streamed: boolean;
  aborted: boolean;
  endpoint: string;
  adaptationMeta?: string | null;
}

/**
 * Asynchronously logs the request and updates spend in the background using queueMicrotask.
 * Will not block client HTTP response.
 */
export function logRequestAsync(payload: LogPayload): void {
  queueMicrotask(() => {
    try {
      const db = getDatabase();
      const id = crypto.randomUUID();
      const now = Date.now();

      let safePoolId: string | null = null;
      if (payload.poolId) {
        try {
          const poolRow = db.query('SELECT 1 FROM pools WHERE id = ?').get(payload.poolId);
          if (poolRow) {
            safePoolId = payload.poolId;
          }
        } catch {}
      }

      db.query(`
        INSERT INTO request_logs (
          id, virtual_key_id, upstream_key_id, pool_id, provider, model,
          prompt_tokens, completion_tokens, total_tokens, cost_usd,
          latency_ms, ttft_ms, status_code, error_message, streamed,
          aborted, endpoint, adaptation_meta, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `).run(
        id,
        payload.virtualKeyId || null,
        payload.upstreamKeyId || null,
        safePoolId,
        payload.provider,
        payload.model,
        payload.promptTokens,
        payload.completionTokens,
        payload.totalTokens,
        payload.costUsd,
        payload.latencyMs,
        payload.ttftMs ?? null,
        payload.statusCode,
        payload.errorMessage || null,
        payload.streamed ? 1 : 0,
        payload.aborted ? 1 : 0,
        payload.endpoint,
        payload.adaptationMeta || null,
        now
      );

      if (payload.virtualKeyId) {
        db.query(`
          UPDATE virtual_keys
          SET current_spend_usd = current_spend_usd + ?,
              current_spend_tokens = current_spend_tokens + ?,
              updated_at = ?
          WHERE id = ?
        `).run(payload.costUsd || 0, payload.totalTokens || 0, now, payload.virtualKeyId);

        // Check if budget thresholds (80% warning or 100% exceeded) were reached
        const updatedVk = db.query('SELECT * FROM virtual_keys WHERE id = ?').get(payload.virtualKeyId) as VirtualKey | null;
        if (updatedVk) {
          const limit = updatedVk.budget_limit > 0 ? updatedVk.budget_limit : (updatedVk.budget_monthly_usd || 0);
          const unit = updatedVk.budget_type || 'usd';
          const cadence = updatedVk.budget_cadence || 'monthly';
          const current = unit === 'tokens' ? updatedVk.current_spend_tokens : updatedVk.current_spend_usd;

          if (limit > 0) {
            if (current >= limit) {
              notifyBudgetExceededAsync(updatedVk, current, limit, unit, cadence);
            } else if (current >= limit * 0.8) {
              notifyBudgetWarningAsync(updatedVk, current, limit, unit, cadence);
            }
          }
        }
      }

      if (payload.upstreamKeyId) {
        db.query(`
          UPDATE upstream_keys
          SET current_daily_tokens = current_daily_tokens + ?,
              current_spend_tokens = current_spend_tokens + ?,
              current_spend_usd = current_spend_usd + ?,
              updated_at = ?
          WHERE id = ?
        `).run(payload.totalTokens || 0, payload.totalTokens || 0, payload.costUsd || 0, now, payload.upstreamKeyId);

        const updatedUk = db.query('SELECT * FROM upstream_keys WHERE id = ?').get(payload.upstreamKeyId) as UpstreamKey | null;
        if (updatedUk) {
          const limit = updatedUk.budget_limit && updatedUk.budget_limit > 0 ? updatedUk.budget_limit : (updatedUk.daily_token_limit || 0);
          const unit = updatedUk.budget_type || 'tokens';
          const current = unit === 'tokens' ? (updatedUk.current_spend_tokens || updatedUk.current_daily_tokens || 0) : (updatedUk.current_spend_usd || 0);

          if (limit > 0 && current >= limit) {
            notifyUpstreamKeyDailyLimitReachedAsync(updatedUk, current, limit);
          }
        }
      }
    } catch (err) {
      console.error('[CapyLLM Async Logger Error]:', err);
    }
  });
}
