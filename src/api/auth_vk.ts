import type { Context, Next } from 'hono';
import { getDatabase, calculateNextResetAt, type VirtualKey } from '../db';
import { hashVirtualKey } from '../crypto';
import { notifyBudgetExceededAsync } from '../engine/telegram';

declare module 'hono' {
  interface ContextVariableMap {
    virtualKey: VirtualKey;
  }
}

// In-memory sliding window rate limiter for virtual keys: keyId -> timestamps[]
const rpmTracker = new Map<string, number[]>();

export async function requireVirtualKey(c: Context, next: Next) {
  const authHeader = c.req.header('authorization') || c.req.header('x-api-key');
  if (!authHeader) {
    return c.json(
      {
        error: {
          message: 'Missing API key in Authorization header (Bearer capy_live_...)',
          type: 'authentication_error',
        },
      },
      401
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return c.json(
      {
        error: {
          message: 'Invalid Authorization header format',
          type: 'authentication_error',
        },
      },
      401
    );
  }

  const keyHash = hashVirtualKey(token);
  const db = getDatabase();

  const vk = db.query('SELECT * FROM virtual_keys WHERE key_hash = ?').get(keyHash) as VirtualKey | null;
  if (!vk) {
    return c.json(
      {
        error: {
          message: 'Invalid API key provided',
          type: 'authentication_error',
        },
      },
      401
    );
  }

  if (vk.is_active !== 1) {
    return c.json(
      {
        error: {
          message: 'This API key has been deactivated',
          type: 'permission_error',
        },
      },
      403
    );
  }

  const now = Date.now();
  const cadence = vk.budget_cadence || 'monthly';

  // Check automated budget reset for periodic cadences
  if (cadence !== 'one-shot' && vk.spend_reset_at > 0 && now >= vk.spend_reset_at) {
    const nextReset = calculateNextResetAt(cadence, now);
    db.query(
      'UPDATE virtual_keys SET current_spend_usd = 0, current_spend_tokens = 0, spend_reset_at = ?, updated_at = ? WHERE id = ?'
    ).run(nextReset, now, vk.id);
    vk.current_spend_usd = 0;
    vk.current_spend_tokens = 0;
    vk.spend_reset_at = nextReset;
  }

  // Budget limit check (Tokens or USD, across Daily/Weekly/Monthly/One-shot)
  const budgetLimit = vk.budget_limit > 0 ? vk.budget_limit : (vk.budget_monthly_usd || 0);
  const budgetType = vk.budget_type || 'usd';

  if (budgetLimit > 0) {
    if (budgetType === 'tokens') {
      const currentTokens = vk.current_spend_tokens || 0;
      if (currentTokens >= budgetLimit) {
        notifyBudgetExceededAsync(vk, currentTokens, budgetLimit, 'tokens', cadence);
        const cadenceLabel = cadence === 'daily' ? 'Daily' : cadence === 'weekly' ? 'Weekly' : cadence === 'monthly' ? 'Monthly' : 'One-shot';
        return c.json(
          {
            error: {
              message: `${cadenceLabel} token limit reached (${currentTokens.toLocaleString()} / ${budgetLimit.toLocaleString()} tokens). Requests blocked until next reset.`,
              type: 'budget_exceeded',
              code: 'token_limit_exceeded',
            },
          },
          429
        );
      }
    } else {
      const currentUsd = vk.current_spend_usd || 0;
      if (currentUsd >= budgetLimit) {
        notifyBudgetExceededAsync(vk, currentUsd, budgetLimit, 'usd', cadence);
        const cadenceLabel = cadence === 'daily' ? 'Daily' : cadence === 'weekly' ? 'Weekly' : cadence === 'monthly' ? 'Monthly' : 'One-shot';
        return c.json(
          {
            error: {
              message: `${cadenceLabel} budget limit reached ($${currentUsd.toFixed(2)} / $${budgetLimit.toFixed(2)} USD). Requests blocked until next reset.`,
              type: 'budget_exceeded',
              code: 'usd_limit_exceeded',
            },
          },
          429
        );
      }
    }
  }

  // RPM check
  if (vk.rate_limit_rpm > 0) {
    const now = Date.now();
    const windowStart = now - 60_000;
    const history = (rpmTracker.get(vk.id) || []).filter(ts => ts > windowStart);
    if (history.length >= vk.rate_limit_rpm) {
      return c.json(
        {
          error: {
            message: `Rate limit of ${vk.rate_limit_rpm} requests per minute exceeded`,
            type: 'rate_limit_error',
          },
        },
        429
      );
    }
    history.push(now);
    rpmTracker.set(vk.id, history);
  }

  c.set('virtualKey', vk);
  await next();
}
