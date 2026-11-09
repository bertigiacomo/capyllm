import { describe, it, expect, beforeEach } from 'bun:test';
import { initDatabase } from '../src/db';
import { calculateCost, resolveModelPrice, upsertPricingRule, clearPricingCache } from '../src/engine/pricing';
import { encryptSecret } from '../src/crypto';

describe('Dynamic Pricing & Token Cost Calculator', () => {
  let db: any;

  beforeEach(() => {
    db = initDatabase(':memory:');
    clearPricingCache();
  });

  it('calculates differentiated prompt and completion token costs correctly', () => {
    upsertPricingRule({
      model: 'gpt-6.1-astra',
      promptPricePer1M: 2.00,
      completionPricePer1M: 8.00,
    });

    // 500k prompt ($1.00) + 250k completion ($2.00) = $3.00
    const cost = calculateCost('gpt-6.1-astra', 500_000, 250_000);
    expect(cost).toBe(3.0);
  });

  it('respects provider-specific pricing overrides for the same model', () => {
    // OpenAI direct: prompt $2.50, completion $10.00
    upsertPricingRule({
      model: 'gpt-6.1-astra',
      provider: 'openai',
      promptPricePer1M: 2.50,
      completionPricePer1M: 10.00,
    });

    // OpenRouter: prompt $2.00, completion $8.00
    upsertPricingRule({
      model: 'gpt-6.1-astra',
      provider: 'openrouter',
      promptPricePer1M: 2.00,
      completionPricePer1M: 8.00,
    });

    const costOpenAI = calculateCost('gpt-6.1-astra', 1_000_000, 1_000_000, { provider: 'openai' });
    expect(costOpenAI).toBe(12.5);

    const costOpenRouter = calculateCost('gpt-6.1-astra', 1_000_000, 1_000_000, { provider: 'openrouter' });
    expect(costOpenRouter).toBe(10.0);
  });

  it('respects upstream key specific pricing overrides', () => {
    const now = Date.now();
    const encKey = encryptSecret('sk-ent-key');
    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active,
        is_free_tier, created_at, updated_at
      ) VALUES ('key-enterprise', 'default', 'openai', 'Enterprise Contract Key', 'https://api.openai.com/v1', ?, 1, 0, ?, ?)
    `).run(encKey, now, now);

    // Standard provider price
    upsertPricingRule({
      model: 'gpt-6.1-astra',
      provider: 'openai',
      promptPricePer1M: 2.50,
      completionPricePer1M: 10.00,
    });

    // Enterprise key special discount
    upsertPricingRule({
      model: 'gpt-6.1-astra',
      upstreamKeyId: 'key-enterprise',
      promptPricePer1M: 1.00,
      completionPricePer1M: 4.00,
    });

    // Standard key call
    const costStandard = calculateCost('gpt-6.1-astra', 1_000_000, 1_000_000, { provider: 'openai', upstreamKeyId: 'key-standard' });
    expect(costStandard).toBe(12.5);

    // Enterprise key call
    const costEnterprise = calculateCost('gpt-6.1-astra', 1_000_000, 1_000_000, { provider: 'openai', upstreamKeyId: 'key-enterprise' });
    expect(costEnterprise).toBe(5.0);
  });

  it('respects CapyKey markup pricing overrides (capyKeyId x model)', () => {
    const now = Date.now();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm, budget_monthly_usd,
        current_spend_usd, spend_reset_at, is_active, created_at, updated_at
      ) VALUES ('capy-client-acme', 'Client Acme', 'hash1', 'capy_live_111111', 0, 100, 0, ?, 1, ?, ?)
    `).run(now, now, now);

    // Base model rate
    upsertPricingRule({
      model: 'claude-3-7-sonnet',
      promptPricePer1M: 3.00,
      completionPricePer1M: 15.00,
    });

    // Reseller CapyKey markup
    upsertPricingRule({
      model: 'claude-3-7-sonnet',
      capyKeyId: 'capy-client-acme',
      promptPricePer1M: 4.50,
      completionPricePer1M: 22.50,
    });

    const costRegular = calculateCost('claude-3-7-sonnet', 1_000_000, 1_000_000);
    expect(costRegular).toBe(18.0);

    const costClient = calculateCost('claude-3-7-sonnet', 1_000_000, 1_000_000, { capyKeyId: 'capy-client-acme' });
    expect(costClient).toBe(27.0);
  });

  it('gives highest priority to upstream key + CapyKey combined override', () => {
    const now = Date.now();
    const encKey = encryptSecret('sk-ds-key');
    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active,
        is_free_tier, created_at, updated_at
      ) VALUES ('key-deepseek-1', 'default', 'deepseek', 'DeepSeek Direct', 'https://api.deepseek.com', ?, 1, 0, ?, ?)
    `).run(encKey, now, now);

    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm, budget_monthly_usd,
        current_spend_usd, spend_reset_at, is_active, created_at, updated_at
      ) VALUES ('capy-vip', 'VIP CapyKey', 'hash2', 'capy_live_222222', 0, 100, 0, ?, 1, ?, ?)
    `).run(now, now, now);

    upsertPricingRule({
      model: 'deepseek-v3',
      promptPricePer1M: 0.14,
      completionPricePer1M: 0.28,
    });

    upsertPricingRule({
      model: 'deepseek-v3',
      upstreamKeyId: 'key-deepseek-1',
      capyKeyId: 'capy-vip',
      promptPricePer1M: 0.05,
      completionPricePer1M: 0.10,
    });

    const price = resolveModelPrice('deepseek-v3', {
      upstreamKeyId: 'key-deepseek-1',
      capyKeyId: 'capy-vip',
    });
    expect(price.promptPer1M).toBe(0.05);
    expect(price.completionPer1M).toBe(0.10);
  });

  it('handles provider wildcard (*) and global wildcard (*)', () => {
    // Global fallback
    upsertPricingRule({
      model: '*',
      promptPricePer1M: 1.00,
      completionPricePer1M: 2.00,
    });

    // Provider wildcard fallback
    upsertPricingRule({
      model: '*',
      provider: 'groq',
      promptPricePer1M: 0.50,
      completionPricePer1M: 0.80,
    });

    // Unknown model on groq uses groq wildcard
    const groqPrice = resolveModelPrice('custom-llama-groq', { provider: 'groq' });
    expect(groqPrice.promptPer1M).toBe(0.50);
    expect(groqPrice.completionPer1M).toBe(0.80);

    // Unknown model on other provider uses global wildcard
    const otherPrice = resolveModelPrice('unknown-model-xyz', { provider: 'other' });
    expect(otherPrice.promptPer1M).toBe(1.00);
    expect(otherPrice.completionPer1M).toBe(2.00);
  });

  it('enforces zero cost for free tier upstream keys and local providers', () => {
    const now = Date.now();
    const encKey = encryptSecret('sk-free-key');
    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active,
        is_free_tier, created_at, updated_at
      ) VALUES ('key-free-student', 'default', 'openai', 'Student Free Tier', 'https://api.openai.com/v1', ?, 1, 1, ?, ?)
    `).run(encKey, now, now);

    // Rule exists for model
    upsertPricingRule({
      model: 'gpt-6.1-astra',
      promptPricePer1M: 5.0,
      completionPricePer1M: 15.0,
    });

    // When used with free tier key, cost is $0.00
    const costFreeKey = calculateCost('gpt-6.1-astra', 1_000_000, 1_000_000, {
      upstreamKeyId: 'key-free-student',
    });
    expect(costFreeKey).toBe(0);

    // Local provider (ollama) returns 0 cost
    const costOllama = calculateCost('llama3:70b', 1_000_000, 1_000_000, { provider: 'ollama' });
    expect(costOllama).toBe(0);

    // Jev is a commercial paid decision service, requires pricing rule or defaults to 0
    upsertPricingRule({
      model: 'system-one',
      provider: 'jev',
      promptPricePer1M: 1.50,
      completionPricePer1M: 3.00,
    });
    const costJev = calculateCost('system-one', 1_000_000, 1_000_000, { provider: 'jev' });
    expect(costJev).toBe(4.50);
  });
});
