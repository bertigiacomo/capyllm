import { getDatabase, calculateNextResetAt, type UpstreamKey, type Pool } from '../db';
import { notifyKeyCooldownAsync } from './telegram';
import { decryptSecret, sanitizeErrorMessage } from '../crypto';
import { providers } from '@opencode-ai/models/snapshot';

const roundRobinCounters = new Map<string, number>();

export function clearRoundRobinCounters(): void {
  roundRobinCounters.clear();
}

export function resetPoolCounter(poolId: string): void {
  roundRobinCounters.delete(poolId);
}

export interface SelectedKey {
  key: UpstreamKey;
  apiKey: string;
  routeId?: string;
  poolId?: string;
  targetModel?: string;
  isCrossModelFallback?: boolean;
  reasoningPolicy?: string;
}

export interface PoolBudgetCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates pool budget (tokens or USD) and applies automated periodic reset.
 */
export function checkPoolBudget(poolId: string): PoolBudgetCheck {
  if (!poolId) return { allowed: false, reason: 'No pool ID specified' };
  const db = getDatabase();
  const pool = db.query('SELECT * FROM pools WHERE id = ?').get(poolId) as Pool | null;
  if (!pool) {
    // If pool has not been explicitly configured in DB, allow request without pool-level budget limit
    return { allowed: true };
  }

  const now = Date.now();
  // Check cadence reset
  if (pool.spend_reset_at && now >= pool.spend_reset_at) {
    const nextReset = calculateNextResetAt(pool.budget_cadence, now);
    db.query(`
      UPDATE pools
      SET current_spend_tokens = 0, current_spend_usd = 0, spend_reset_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nextReset, now, pool.id);
    pool.current_spend_tokens = 0;
    pool.current_spend_usd = 0;
    pool.spend_reset_at = nextReset;
  }

  if (pool.budget_limit > 0) {
    if (pool.budget_type === 'tokens' && pool.current_spend_tokens >= pool.budget_limit) {
      return {
        allowed: false,
        reason: `Pool '${pool.name}' limit of ${pool.budget_limit.toLocaleString()} tokens exhausted for current ${pool.budget_cadence} period.`,
      };
    }
    if (pool.budget_type === 'usd' && pool.current_spend_usd >= pool.budget_limit) {
      return {
        allowed: false,
        reason: `Pool '${pool.name}' budget limit of $${pool.budget_limit.toFixed(2)} reached for current ${pool.budget_cadence} period.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Accumulates token and cost spend on the pool and on the specific model route.
 */
export function recordPoolSpend(poolId: string, tokens: number, costUsd: number, routeId?: string): void {
  if (!poolId) return;
  try {
    const db = getDatabase();
    const now = Date.now();
    db.query(`
      UPDATE pools
      SET current_spend_tokens = current_spend_tokens + ?,
          current_spend_usd = current_spend_usd + ?,
          updated_at = ?
      WHERE id = ?
    `).run(tokens, costUsd, now, poolId);

    if (routeId) {
      db.query(`
        UPDATE pool_routes
        SET current_tokens = current_tokens + ?,
            current_cost = current_cost + ?
        WHERE id = ?
      `).run(tokens, costUsd, routeId);
    }
  } catch {}
}

/**
 * Resets token and cost spend on a specific model route in a pool.
 */
export function resetRouteSpend(routeId: string): void {
  if (!routeId) return;
  try {
    const db = getDatabase();
    db.query(`
      UPDATE pool_routes
      SET current_tokens = 0, current_cost = 0
      WHERE id = ?
    `).run(routeId);
  } catch {}
}

/**
 * Normalizes model identifier by removing vendor/namespace prefix (e.g. "openai/gpt-4o" -> "gpt-4o").
 */
export function stripProviderPrefix(model: string): string {
  if (!model) return '';
  const trimmed = model.trim();
  const slashIdx = trimmed.indexOf('/');
  return slashIdx !== -1 ? trimmed.slice(slashIdx + 1) : trimmed;
}

/**
 * Resolves the transparent upstream model name based on target provider conventions
 * and live zero-token discovered models.
 * - e.g. OpenRouter: 'gpt-4o' -> 'openai/gpt-4o'
 * - e.g. OpenAI native: 'openai/gpt-4o' -> 'gpt-4o'
 */
export function resolveModelForUpstream(
  requestedModel: string,
  provider: string,
  discoveredModelsJson?: string | null
): string {
  if (!requestedModel || requestedModel === '*' || requestedModel === 'unknown') return requestedModel;
  const stripped = stripProviderPrefix(requestedModel);
  let discovered: string[] = [];
  try {
    if (discoveredModelsJson) {
      const parsed = typeof discoveredModelsJson === 'string' ? JSON.parse(discoveredModelsJson) : discoveredModelsJson;
      if (Array.isArray(parsed)) discovered = parsed;
    }
  } catch {}

  // 1. Corrispondenza esatta già presente tra i modelli scoperti
  if (discovered.includes(requestedModel)) return requestedModel;

  // 2. Corrispondenza con prefisso (es. OpenRouter: 'gpt-4o' -> 'openai/gpt-4o')
  const prefixed = discovered.find((m) => m.endsWith(`/${stripped}`));
  if (prefixed) return prefixed;

  // 3. Corrispondenza senza prefisso (es. OpenAI: 'openai/gpt-4o' -> 'gpt-4o')
  const directMatch = discovered.find((m) => m === stripped);
  if (directMatch) return directMatch;

  // 4. Risoluzione dinamica per OpenRouter da catalogo models.dev
  if (provider.toLowerCase() === 'openrouter') {
    const orCatalog = (providers as any)?.openrouter?.models || {};
    const orFound = Object.keys(orCatalog).find((m) => m.endsWith(`/${stripped}`) || m === stripped);
    if (orFound) return orFound;

    // Ricerca del fornitore originale tramite lo snapshot ufficiale di models.dev
    const primaryOrigins = ['openai', 'anthropic', 'google', 'meta-llama', 'mistralai', 'deepseek', 'qwen', 'cohere'];
    for (const origin of primaryOrigins) {
      if ((providers as any)[origin]?.models?.[stripped]) {
        return `${origin}/${stripped}`;
      }
    }

    // Mappatura di brand per instradamento trasparente namespace su OpenRouter
    if (stripped.startsWith('gpt-') || stripped.startsWith('chatgpt')) return `openai/${stripped}`;
    if (stripped.startsWith('claude')) return `anthropic/${stripped}`;
    if (stripped.startsWith('gemini')) return `google/${stripped}`;
    if (stripped.startsWith('deepseek')) return `deepseek/${stripped}`;
    if (stripped.startsWith('mistral') || stripped.startsWith('codestral') || stripped.startsWith('pixtral')) return `mistralai/${stripped}`;
    if (stripped.startsWith('llama')) return `meta-llama/${stripped}`;
    if (stripped.startsWith('qwen')) return `qwen/${stripped}`;
  }

  // 5. Euristica per provider diretti: strip del prefisso se non è OpenRouter
  if (provider.toLowerCase() !== 'openrouter') {
    return stripped;
  }

  return requestedModel;
}

function testWildcard(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true;
  if (!pattern.includes('*')) return pattern === value;
  const regexStr = '^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
  try {
    return new RegExp(regexStr).test(value);
  } catch {
    return pattern === value;
  }
}

/**
 * Matches a model identifier against a wildcard pattern (e.g. "gpt-4o", "*-mini", "gpt-4*").
 * Recognizes canonical models transparently across prefixed and direct formats (e.g. "openai/gpt-4o" vs "gpt-4o").
 */
export function matchModelPattern(pattern: string, requestedModel: string): boolean {
  if (pattern === '*' || requestedModel === '*' || requestedModel === 'unknown') return true;
  const p = pattern.trim().toLowerCase();
  const m = requestedModel.trim().toLowerCase();
  if (p === m) return true;

  const pStripped = stripProviderPrefix(p);
  const mStripped = stripProviderPrefix(m);
  if (pStripped === mStripped) return true;

  return testWildcard(p, m) || testWildcard(pStripped, mStripped);
}

/**
 * Checks whether an upstream key supports a given API schema endpoint.
 */
export function keySupportsSchema(k: UpstreamKey, requiredSchema?: string): boolean {
  if (!requiredSchema || requiredSchema === '*') return true;
  let schemas: string[] = [];
  if ((k as any).supported_schemas) {
    try {
      const parsed = typeof (k as any).supported_schemas === 'string'
        ? JSON.parse((k as any).supported_schemas)
        : (k as any).supported_schemas;
      if (Array.isArray(parsed) && parsed.length > 0) {
        schemas = parsed;
      }
    } catch {}
  }
  if (schemas.length === 0) {
    schemas = [k.api_schema || 'chat_completions'];
  }
  if (schemas.includes('*') || schemas.includes('all')) {
    return true;
  }
  return schemas.includes(requiredSchema) || schemas.includes('custom');
}

/**
 * Returns available active upstream keys for a pool and requested model,
 * respecting route priority (0 = first, 1 = fallback, etc.) and cooldowns.
 */
export function getAvailableKeysForPool(poolId: string, requestedModel: string = '*', requiredSchema?: string): UpstreamKey[] {
  const db = getDatabase();
  const now = Date.now();

  // 1. Primary path: query keys via pool_routes ordered by priority ASC
  let keys = db.query(`
    SELECT k.*, r.id as route_id, r.priority, r.model_pattern, r.reasoning_effort as route_reasoning_effort,
           r.token_limit as route_token_limit, r.current_tokens as route_current_tokens,
           r.cost_limit as route_cost_limit, r.current_cost as route_current_cost
    FROM pool_routes r
    JOIN upstream_keys k ON k.id = r.upstream_key_id
    WHERE r.pool_id = ? AND k.is_active = 1
    ORDER BY r.priority ASC, r.created_at ASC
  `).all(poolId) as (UpstreamKey & {
    route_id?: string;
    priority: number;
    model_pattern: string;
    route_reasoning_effort?: string | null;
    route_token_limit?: number;
    route_current_tokens?: number;
    route_cost_limit?: number;
    route_current_cost?: number;
  })[];

  // Fallback for direct pool_id assignment (e.g. legacy or unrouted keys)
  if (keys.length === 0) {
    keys = db.query(`
      SELECT *, 0 as priority, '*' as model_pattern
      FROM upstream_keys
      WHERE pool_id = ? AND is_active = 1
      ORDER BY created_at ASC
    `).all(poolId) as any[];
  }

  return keys.filter((k) => {
    // Exclude keys in cooldown
    if (k.cooldown_until > now) {
      return false;
    }

    // Exclude if key does not support required API schema
    if (requiredSchema && !keySupportsSchema(k, requiredSchema)) {
      return false;
    }

    // Check key budget limits (tokens or USD) and automated cadence reset
    const keyBudgetLimit = (k as any).budget_limit && (k as any).budget_limit > 0 ? (k as any).budget_limit : (k.daily_token_limit || 0);
    const keyBudgetType = (k as any).budget_type || 'tokens';
    const keyCadence = (k as any).budget_cadence || 'daily';

    if (keyBudgetLimit > 0) {
      const resetTime = (k as any).spend_reset_at || k.daily_tokens_reset_at || 0;
      if (resetTime > 0 && now >= resetTime) {
        const nextReset = calculateNextResetAt(keyCadence as any, now);
        db.query(`
          UPDATE upstream_keys
          SET current_spend_tokens = 0, current_spend_usd = 0, current_daily_tokens = 0,
              spend_reset_at = ?, daily_tokens_reset_at = ?, updated_at = ?
          WHERE id = ?
        `).run(nextReset, nextReset, now, k.id);
        (k as any).current_spend_tokens = 0;
        (k as any).current_spend_usd = 0;
        k.current_daily_tokens = 0;
        (k as any).spend_reset_at = nextReset;
        k.daily_tokens_reset_at = nextReset;
      }

      if (keyBudgetType === 'usd' && ((k as any).current_spend_usd || 0) >= keyBudgetLimit) {
        return false;
      }
      if (keyBudgetType === 'tokens') {
        const tokensSpent = (k as any).current_spend_tokens || k.current_daily_tokens || 0;
        if (tokensSpent >= keyBudgetLimit) {
          return false;
        }
      }
    }

    // Exclude if route has reached its specific token or cost limit for this model
    if ((k as any).route_token_limit && (k as any).route_token_limit > 0 && ((k as any).route_current_tokens || 0) >= (k as any).route_token_limit) {
      return false;
    }
    if ((k as any).route_cost_limit && (k as any).route_cost_limit > 0 && ((k as any).route_current_cost || 0) >= (k as any).route_cost_limit) {
      return false;
    }

    // Model pattern matching if pattern specified
    if (k.model_pattern && k.model_pattern !== '*' && requestedModel !== '*' && requestedModel !== 'unknown') {
      const patterns = k.model_pattern.split(',').map((s) => s.trim().toLowerCase());
      const reqLower = requestedModel.toLowerCase();
      const matched = patterns.some((p) => matchModelPattern(p, reqLower));
      if (!matched) return false;
    }

    return true;
  });
}

/**
 * Selects an upstream key for a pool and requested model according to configured priority.
 * Tiers of equal priority are selected round-robin to distribute traffic.
 * Excludes already attempted keys in the current request attempt.
 */
export function selectKeyFromPool(
  poolId: string,
  excludeKeyIds: Set<string> = new Set(),
  requestedModel: string = '*',
  requiredSchema?: string
): SelectedKey | null {
  const db = getDatabase();
  const available = getAvailableKeysForPool(poolId, requestedModel, requiredSchema).filter((k) => !excludeKeyIds.has(k.id));
  
  const pool = db.query('SELECT allow_cross_model_fallback, reasoning_policy FROM pools WHERE id = ?').get(poolId) as { allow_cross_model_fallback?: number; reasoning_policy?: string } | null;
  const poolPolicy = pool?.reasoning_policy || 'inherit';

  if (available.length > 0) {
    // Find lowest priority number in available keys (0 is highest priority)
    const minPriority = (available[0] as any).priority ?? 0;
    const topTier = available.filter((k) => ((k as any).priority ?? 0) === minPriority);

    const idx = roundRobinCounters.has(poolId)
      ? (roundRobinCounters.get(poolId)! + 1) % topTier.length
      : 0;
    roundRobinCounters.set(poolId, idx);

    const orderedCandidates = [
      ...topTier.slice(idx),
      ...topTier.slice(0, idx),
      ...available.filter((k) => ((k as any).priority ?? 0) > minPriority),
    ];

    for (const candidate of orderedCandidates) {
      const dec = decryptSecret(candidate.encrypted_key);
      if (!dec.success || !dec.data) {
        markKeyError(candidate.id, `Decryption error: ${dec.error || 'Unknown'}`);
        excludeKeyIds.add(candidate.id);
        continue;
      }

      let targetModel = requestedModel;
      const pat = (candidate as any).model_pattern;
      if (pat && pat !== '*') {
        const patterns = pat.split(',').map((s: string) => s.trim());
        const exactMatch = patterns.find((p: string) => matchModelPattern(p, requestedModel));
        if (exactMatch && !exactMatch.includes('*')) {
          targetModel = exactMatch;
        } else if (requestedModel === '*' || requestedModel === 'unknown') {
          targetModel = patterns[0];
        }
      }

      targetModel = resolveModelForUpstream(targetModel, candidate.provider, candidate.discovered_models);
      const routeEffort = (candidate as any).route_reasoning_effort;
      const effectivePolicy = routeEffort && routeEffort !== 'inherit' ? routeEffort : poolPolicy;

      return {
        key: candidate,
        apiKey: dec.data,
        routeId: (candidate as any).route_id,
        poolId,
        targetModel,
        isCrossModelFallback: false,
        reasoningPolicy: effectivePolicy,
      };
    }
  }

  // Cross-Model Fallback / Resilience: if primary model is unavailable or cooling down,
  // check if pool has allow_cross_model_fallback enabled to cascade to fallback models (e.g. Terra -> Luna)
  if (pool && (pool.allow_cross_model_fallback === 1 || (pool.allow_cross_model_fallback as any) === true)) {
    const allFallbackKeys = getAvailableKeysForPool(poolId, '*', requiredSchema).filter((k) => !excludeKeyIds.has(k.id));
    if (allFallbackKeys.length > 0) {
      const minPriority = (allFallbackKeys[0] as any).priority ?? 0;
      const topTier = allFallbackKeys.filter((k) => ((k as any).priority ?? 0) === minPriority);

      for (const candidate of topTier) {
        const dec = decryptSecret(candidate.encrypted_key);
        if (!dec.success || !dec.data) {
          markKeyError(candidate.id, `Decryption error: ${dec.error || 'Unknown'}`);
          excludeKeyIds.add(candidate.id);
          continue;
        }

        let fallbackModel = requestedModel;
        const pat = (candidate as any).model_pattern;
        if (pat && pat !== '*') {
          fallbackModel = pat.split(',')[0].trim();
        } else if (candidate.discovered_models) {
          try {
            const disc = JSON.parse(candidate.discovered_models);
            if (Array.isArray(disc) && disc.length > 0) fallbackModel = disc[0];
          } catch {}
        }

        fallbackModel = resolveModelForUpstream(fallbackModel, candidate.provider, candidate.discovered_models);
        const routeEffort = (candidate as any).route_reasoning_effort;
        const effectivePolicy = routeEffort && routeEffort !== 'inherit' ? routeEffort : poolPolicy;

        return {
          key: candidate,
          apiKey: dec.data,
          routeId: (candidate as any).route_id,
          poolId,
          targetModel: fallbackModel,
          isCrossModelFallback: true,
          reasoningPolicy: effectivePolicy,
        };
      }
    }
  }

  return null;
}

/**
 * Fallback selector for multiple pools.
 */
export function selectKeyFromPools(
  poolIds: string[],
  excludeKeyIds: Set<string> = new Set(),
  requestedModel: string = '*',
  requiredSchema?: string
): SelectedKey | null {
  for (const poolId of poolIds) {
    const budget = checkPoolBudget(poolId);
    if (!budget.allowed) continue;
    const selected = selectKeyFromPool(poolId, excludeKeyIds, requestedModel, requiredSchema);
    if (selected) {
      return selected;
    }
  }
  return null;
}

/**
 * Diagnoses why a pool has no active keys available (cooldown vs unrouted).
 */
export function diagnosePoolUnavailable(
  poolIds: string[],
  requestedModel: string = '*',
  requiredSchema?: string
): { isCooldown: boolean; retryAfterSeconds: number; reason: string } {
  let hasAnyMatchingKeys = false;
  let minCooldownRemaining = Infinity;
  const now = Date.now();
  const db = getDatabase();

  for (const poolId of poolIds) {
    const routedKeys = db.query(`
      SELECT k.*, r.model_pattern
      FROM pool_routes r
      JOIN upstream_keys k ON r.upstream_key_id = k.id
      WHERE r.pool_id = ? AND k.is_active = 1
    `).all(poolId) as (UpstreamKey & { model_pattern?: string })[];

    const keys = routedKeys.length > 0 ? routedKeys : (db.query(`
      SELECT *, '*' as model_pattern FROM upstream_keys WHERE pool_id = ? AND is_active = 1
    `).all(poolId) as any[]);

    for (const key of keys) {
      if (requiredSchema && !keySupportsSchema(key, requiredSchema)) {
        continue;
      }

      if (key.model_pattern && key.model_pattern !== '*' && requestedModel !== '*' && requestedModel !== 'unknown') {
        const patterns = key.model_pattern.split(',').map((s: string) => s.trim().toLowerCase());
        const matched = patterns.some((p: string) => matchModelPattern(p, requestedModel));
        if (!matched) continue;
      }

      hasAnyMatchingKeys = true;
      if (key.cooldown_until && key.cooldown_until > now) {
        const remainingSec = Math.ceil((key.cooldown_until - now) / 1000);
        if (remainingSec < minCooldownRemaining) {
          minCooldownRemaining = remainingSec;
        }
      }
    }
  }

  if (hasAnyMatchingKeys && minCooldownRemaining < Infinity) {
    return {
      isCooldown: true,
      retryAfterSeconds: Math.max(1, minCooldownRemaining),
      reason: 'All upstream providers in this pool are currently cooling down. Please retry shortly.',
    };
  }

  return {
    isCooldown: false,
    retryAfterSeconds: 0,
    reason: hasAnyMatchingKeys
      ? 'All upstream keys in this pool have exhausted their daily quotas'
      : `No upstream routes configured for model '${requestedModel}' in this pool`,
  };
}

/**
 * Transforms request payload based on custom schema config or reasoning mappings.
 */
export function transformPayloadForUpstream(
  parsedBody: any,
  upstreamKey: UpstreamKey
): { body: string; headers: Record<string, string> } {
  const customHeaders: Record<string, string> = {};
  if (!parsedBody || typeof parsedBody !== 'object') {
    return { body: JSON.stringify(parsedBody || {}), headers: customHeaders };
  }

  // Deep clone payload to avoid mutating original object across retries
  let payload: any;
  try {
    payload = JSON.parse(JSON.stringify(parsedBody));
  } catch {
    payload = { ...parsedBody };
  }

  // Parse custom_schema_config if present
  let customConfig: any = null;
  if (upstreamKey.custom_schema_config) {
    try {
      customConfig = JSON.parse(upstreamKey.custom_schema_config);
    } catch {}
  }

  if (customConfig && typeof customConfig === 'object') {
    // 1. Parameter renames (e.g. reasoning_effort -> thinking_effort or thinkingConfig.thinking_level)
    if (customConfig.param_renames && typeof customConfig.param_renames === 'object') {
      for (const [sourceKey, targetKey] of Object.entries(customConfig.param_renames)) {
        if (payload[sourceKey] !== undefined) {
          const val = payload[sourceKey];
          delete payload[sourceKey];
          // Handle nested dot notation like "thinkingConfig.level" with prototype pollution safety
          if (typeof targetKey === 'string' && targetKey.includes('.')) {
            const parts = targetKey.split('.');
            if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) {
              continue;
            }
            let curr = payload;
            for (let i = 0; i < parts.length - 1; i++) {
              curr[parts[i]] = curr[parts[i]] || {};
              curr = curr[parts[i]];
            }
            curr[parts[parts.length - 1]] = val;
          } else if (typeof targetKey === 'string') {
            payload[targetKey] = val;
          }
        }
      }
    }

    // 2. Value mappings (e.g. { "reasoning_value_map": { "low": "minimal", "high": "max" } })
    if (customConfig.reasoning_value_map && typeof customConfig.reasoning_value_map === 'object') {
      const currentVal = payload.reasoning_effort || payload.thinking_effort;
      if (currentVal && customConfig.reasoning_value_map[currentVal]) {
        const mapped = customConfig.reasoning_value_map[currentVal];
        if (payload.reasoning_effort) payload.reasoning_effort = mapped;
        if (payload.thinking_effort) payload.thinking_effort = mapped;
      }
    }

    // 3. Body overrides (e.g. default parameters injected)
    if (customConfig.body_overrides && typeof customConfig.body_overrides === 'object') {
      Object.assign(payload, customConfig.body_overrides);
    }

    // 4. Header overrides
    if (customConfig.header_overrides && typeof customConfig.header_overrides === 'object') {
      for (const [hKey, hVal] of Object.entries(customConfig.header_overrides)) {
        if (typeof hVal === 'string') {
          customHeaders[hKey] = hVal;
        }
      }
    }
  }

  return {
    body: JSON.stringify(payload),
    headers: customHeaders,
  };
}

/**
 * Mark a key as having an error (e.g. invalid key or bad decryption).
 */
export function markKeyError(keyId: string, errorMsg: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.query(`
    UPDATE upstream_keys
    SET last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(errorMsg, now, keyId);
}

/**
 * Mark key as successful: reset fail_count and clear last_error.
 */
export function markKeySuccess(keyId: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.query(`
    UPDATE upstream_keys
    SET fail_count = 0, last_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(now, keyId);
}

/**
 * Calculates cooldown duration based on Retry-After header or progressive backoff:
 * fail_count 0 -> 60s
 * fail_count 1 -> 120s
 * fail_count >= 2 -> 300s
 */
export function calculateCooldownMs(failCount: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    const parsedDate = Date.parse(retryAfterHeader);
    if (!isNaN(parsedDate) && parsedDate > Date.now()) {
      return parsedDate - Date.now();
    }
  }

  // Progressive backoff: 60s / 120s / 300s
  if (failCount === 0) return 60_000;
  if (failCount === 1) return 120_000;
  return 300_000;
}

/**
 * Puts an upstream key into cooldown after HTTP 429, incrementing fail_count.
 */
export function markKeyCooldown(key: UpstreamKey, retryAfterHeader?: string | null): void {
  const db = getDatabase();
  const cooldownMs = calculateCooldownMs(key.fail_count, retryAfterHeader);
  const now = Date.now();
  const cooldownUntil = now + cooldownMs;
  const newFailCount = key.fail_count + 1;
  const errorMsg = `Rate limited (HTTP 429). Cooldown for ${Math.round(cooldownMs / 1000)}s until ${new Date(cooldownUntil).toISOString()}`;

  db.query(`
    UPDATE upstream_keys
    SET cooldown_until = ?, fail_count = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(cooldownUntil, newFailCount, errorMsg, now, key.id);

  notifyKeyCooldownAsync(key, newFailCount, Math.round(cooldownMs / 1000), errorMsg);
}

/**
 * Resets cooldown for a key immediately.
 */
export function resetKeyCooldown(keyId: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.query(`
    UPDATE upstream_keys
    SET cooldown_until = 0, fail_count = 0, last_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(now, keyId);
}
