import { getDatabase, type ModelPricing } from '../db';
import { matchModelPattern } from './pool';
import crypto from 'node:crypto';

export interface ModelPrice {
  promptPer1M: number;
  completionPer1M: number;
}

export interface PricingContext {
  provider?: string;
  upstreamKeyId?: string | null;
  capyKeyId?: string | null;
}

// In-memory cache for ultra-fast lookup (invalidated on updates)
let cachedRules: ModelPricing[] | null = null;

export function clearPricingCache(): void {
  cachedRules = null;
}

function loadPricingRules(): ModelPricing[] {
  if (cachedRules) return cachedRules;
  try {
    const db = getDatabase();
    cachedRules = db.query('SELECT * FROM model_pricing ORDER BY created_at DESC').all() as ModelPricing[];
    return cachedRules;
  } catch {
    return [];
  }
}

/**
 * Resolves the token price per 1M tokens based on the hierarchy:
 * 1. Key + CapyKey + Model
 * 2. Key + Model
 * 3. CapyKey + Model
 * 4. Provider + Model
 * 5. Generic Model
 * 6. Provider Wildcard (*)
 * 7. Global Wildcard (*)
 * 8. Fallback (0.00)
 */
export function resolveModelPrice(
  model: string,
  context?: PricingContext
): ModelPrice {
  // If upstream key is marked as free tier, return 0 cost immediately
  if (context?.upstreamKeyId) {
    try {
      const db = getDatabase();
      const keyRow = db.query('SELECT is_free_tier, provider FROM upstream_keys WHERE id = ?').get(context.upstreamKeyId) as { is_free_tier?: number; provider?: string } | null;
      if (keyRow?.is_free_tier) {
        return { promptPer1M: 0, completionPer1M: 0 };
      }
      if (!context.provider && keyRow?.provider) {
        context.provider = keyRow.provider;
      }
    } catch {}
  }

  // Free local inference providers (only Ollama running locally)
  if (context?.provider === 'ollama') {
    return { promptPer1M: 0, completionPer1M: 0 };
  }

  const rules = loadPricingRules();
  const normalizedModel = (model || '').toLowerCase().trim();
  const normalizedProvider = (context?.provider || '').toLowerCase().trim();
  const keyId = context?.upstreamKeyId || null;
  const capyKeyId = context?.capyKeyId || null;

  let bestRule: ModelPricing | null = null;
  let highestScore = -1;

  for (const r of rules) {
    const ruleModel = r.model.toLowerCase().trim();
    const ruleProvider = (r.provider || '').toLowerCase().trim();

    const modelMatches = ruleModel === '*' || ruleModel === normalizedModel || matchModelPattern(ruleModel, normalizedModel);
    if (!modelMatches) continue;

    // Provider check if specified
    if (ruleProvider && ruleProvider !== '*' && normalizedProvider && ruleProvider !== normalizedProvider) {
      continue;
    }

    let score = 0;
    const isExactModel = ruleModel === normalizedModel;

    // Specificity scoring
    if (r.upstream_key_id && r.upstream_key_id === keyId && r.capy_key_id && r.capy_key_id === capyKeyId && isExactModel) {
      score = 70;
    } else if (r.upstream_key_id && r.upstream_key_id === keyId && isExactModel) {
      score = 60;
    } else if (r.capy_key_id && r.capy_key_id === capyKeyId && isExactModel) {
      score = 50;
    } else if (ruleProvider && ruleProvider === normalizedProvider && isExactModel) {
      score = 40;
    } else if (isExactModel && (!ruleProvider || ruleProvider === '*') && !r.upstream_key_id && !r.capy_key_id) {
      score = 30; // Generic exact model match
    } else if (ruleProvider && ruleProvider === normalizedProvider && ruleModel === '*') {
      score = 20; // Provider default wildcard
    } else if (matchModelPattern(ruleModel, normalizedModel) && ruleModel !== '*') {
      score = 15; // Wildcard pattern match (e.g. gpt-4*)
    } else if (ruleModel === '*' && (!ruleProvider || ruleProvider === '*') && !r.upstream_key_id && !r.capy_key_id) {
      score = 10; // Global fallback
    }

    if (score > highestScore) {
      highestScore = score;
      bestRule = r;
    }
  }

  if (bestRule) {
    return {
      promptPer1M: bestRule.prompt_price_per_1m,
      completionPer1M: bestRule.completion_price_per_1m,
    };
  }

  // If no user-defined price rule found, default to $0.00
  return { promptPer1M: 0, completionPer1M: 0 };
}

/**
 * Calculates total request cost in USD differentiating between prompt (input) and completion (output) tokens.
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  context?: PricingContext
): number {
  const price = resolveModelPrice(model, context);
  const promptCost = (promptTokens / 1_000_000) * price.promptPer1M;
  const completionCost = (completionTokens / 1_000_000) * price.completionPer1M;
  return Number((promptCost + completionCost).toFixed(6));
}

/**
 * Helper to add or replace a custom pricing rule in SQLite
 */
export function upsertPricingRule(data: {
  model: string;
  provider?: string | null;
  upstreamKeyId?: string | null;
  capyKeyId?: string | null;
  promptPricePer1M: number;
  completionPricePer1M: number;
}): ModelPricing {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();

  db.query(`
    INSERT INTO model_pricing (
      id, model, provider, upstream_key_id, capy_key_id,
      prompt_price_per_1m, completion_price_per_1m, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.model.trim(),
    data.provider?.trim() || null,
    data.upstreamKeyId || null,
    data.capyKeyId || null,
    data.promptPricePer1M,
    data.completionPricePer1M,
    now,
    now
  );

  clearPricingCache();

  return {
    id,
    model: data.model.trim(),
    provider: data.provider?.trim() || null,
    upstream_key_id: data.upstreamKeyId || null,
    capy_key_id: data.capyKeyId || null,
    prompt_price_per_1m: data.promptPricePer1M,
    completion_price_per_1m: data.completionPricePer1M,
    created_at: now,
    updated_at: now,
  };
}
