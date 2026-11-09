import { describe, it, expect, beforeEach } from 'bun:test';
import { initDatabase, getDatabase, closeDatabase, calculateNextResetAt } from '../src/db';
import { generateVirtualKey, encryptSecret } from '../src/crypto';
import { app } from '../src/index';

describe('CapyKey Token Budgets, Cadences & Model Partitioning', () => {
  beforeEach(() => {
    closeDatabase();
    process.env.CAPY_DB_PATH = ':memory:';
    process.env.CAPY_MASTER_KEY = 'test-master-key-32-chars-length!!';
    initDatabase(':memory:');
  });

  it('calculates next reset timestamp according to cadence and reset hour', () => {
    const now = 1700000000000;
    expect(calculateNextResetAt('one-shot', now)).toBe(0);

    // Wall-clock daily reset with default reset hour (00:00)
    const nextDaily = calculateNextResetAt('daily', now, 0);
    const dateDaily = new Date(nextDaily);
    expect(nextDaily).toBeGreaterThan(now);
    expect(dateDaily.getHours()).toBe(0);
    expect(dateDaily.getMinutes()).toBe(0);
    expect(dateDaily.getSeconds()).toBe(0);

    // Configurable reset hour (e.g. 4 AM)
    const nextDaily4am = calculateNextResetAt('daily', now, 4);
    const dateDaily4am = new Date(nextDaily4am);
    expect(nextDaily4am).toBeGreaterThan(now);
    expect(dateDaily4am.getHours()).toBe(4);

    // Weekly reset on Monday at reset hour
    const nextWeekly = calculateNextResetAt('weekly', now, 0);
    const dateWeekly = new Date(nextWeekly);
    expect(nextWeekly).toBeGreaterThan(now);
    expect(dateWeekly.getDay()).toBe(1); // Monday
    expect(dateWeekly.getHours()).toBe(0);

    // Monthly reset on 1st of next month at reset hour
    const nextMonthly = calculateNextResetAt('monthly', now, 0);
    const dateMonthly = new Date(nextMonthly);
    expect(nextMonthly).toBeGreaterThan(now);
    expect(dateMonthly.getDate()).toBe(1); // 1st
    expect(dateMonthly.getHours()).toBe(0);
  });

  it('enforces model restriction on Frontier CapyKey vs Base CapyKey sharing the same upstream key', async () => {
    const db = getDatabase();
    const now = Date.now();

    // 1. Create a shared OpenAI upstream key
    const encryptedKey = encryptSecret('sk-mock-openai-key');
    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active, cooldown_until, fail_count, last_error, discovered_models, created_at, updated_at
      ) VALUES ('key-openai', 'default', 'openai', 'Shared OpenAI Key', 'https://api.openai.com/v1', ?, 1, 0, 0, NULL, ?, ?, ?)
    `).run(
      encryptedKey,
      JSON.stringify(['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini']),
      now,
      now
    );

    // 2. CapyKey A: "Frontier Models" (250,000 tokens / daily, allowed: gpt-4o, o1, o3-mini)
    const vkFrontier = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm,
        budget_type, budget_cadence, budget_limit, budget_monthly_usd,
        current_spend_usd, current_spend_tokens, spend_reset_at,
        allowed_pools, allowed_models, is_active, created_at, updated_at
      ) VALUES (
        'vk-frontier', 'OpenAI Frontier (250k/day)', ?, ?, 0,
        'tokens', 'daily', 250000, 0,
        0, 0, ?,
        NULL, ?, 1, ?, ?
      )
    `).run(
      vkFrontier.keyHash,
      vkFrontier.keyPrefix,
      now + 24 * 3600 * 1000,
      JSON.stringify(['gpt-4o', 'o1', 'o3-mini']),
      now,
      now
    );

    // 3. CapyKey B: "Base Models" (2,500,000 tokens / daily, allowed: gpt-4o-mini)
    const vkBase = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm,
        budget_type, budget_cadence, budget_limit, budget_monthly_usd,
        current_spend_usd, current_spend_tokens, spend_reset_at,
        allowed_pools, allowed_models, is_active, created_at, updated_at
      ) VALUES (
        'vk-base', 'OpenAI Base (2.5M/day)', ?, ?, 0,
        'tokens', 'daily', 2500000, 0,
        0, 0, ?,
        NULL, ?, 1, ?, ?
      )
    `).run(
      vkBase.keyHash,
      vkBase.keyPrefix,
      now + 24 * 3600 * 1000,
      JSON.stringify(['gpt-4o-mini']),
      now,
      now
    );

    // Test A: Calling Base model (gpt-4o-mini) with Frontier CapyKey should be BLOCKED (403)
    const resA = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vkFrontier.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });
    expect(resA.status).toBe(403);
    const bodyA: any = await resA.json();
    expect(bodyA.error.message).toContain("Model 'gpt-4o-mini' is not allowed");

    // Test B: Calling Frontier model (gpt-4o) with Base CapyKey should be BLOCKED (403)
    const resB = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vkBase.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });
    expect(resB.status).toBe(403);
    const bodyB: any = await resB.json();
    expect(bodyB.error.message).toContain("Model 'gpt-4o' is not allowed");
  });

  it('hard-stops when daily token budget is reached (e.g. 250,000 tokens)', async () => {
    const db = getDatabase();
    const now = Date.now();
    const vk = generateVirtualKey();

    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm,
        budget_type, budget_cadence, budget_limit, budget_monthly_usd,
        current_spend_usd, current_spend_tokens, spend_reset_at,
        allowed_pools, allowed_models, is_active, created_at, updated_at
      ) VALUES (
        'vk-daily-quota', 'Daily Quota Key', ?, ?, 0,
        'tokens', 'daily', 250000, 0,
        0, 250000, ?,
        NULL, NULL, 1, ?, ?
      )
    `).run(
      vk.keyHash,
      vk.keyPrefix,
      now + 24 * 3600 * 1000,
      now,
      now
    );

    const res = await app.request('/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${vk.fullKey}`,
      },
    });

    expect(res.status).toBe(429);
    const body: any = await res.json();
    expect(body.error.message).toContain('Daily token limit reached (250,000 / 250,000 tokens)');
  });

  it('supports Mercury by Inception one-shot lifetime grant (e.g. 100,000,000 tokens)', async () => {
    const db = getDatabase();
    const now = Date.now();
    const vk = generateVirtualKey();

    // 100M one-shot grant: spend_reset_at = 0 (never resets)
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm,
        budget_type, budget_cadence, budget_limit, budget_monthly_usd,
        current_spend_usd, current_spend_tokens, spend_reset_at,
        allowed_pools, allowed_models, is_active, created_at, updated_at
      ) VALUES (
        'vk-mercury', 'Mercury Inception One-Shot Grant', ?, ?, 0,
        'tokens', 'one-shot', 100000000, 0,
        0, 99999999, 0,
        NULL, NULL, 1, ?, ?
      )
    `).run(vk.keyHash, vk.keyPrefix, now, now);

    // Still within limit
    const resWithin = await app.request('/v1/models', {
      headers: { 'Authorization': `Bearer ${vk.fullKey}` },
    });
    expect(resWithin.status).toBe(200);

    // Simulate consuming the remaining token
    db.query('UPDATE virtual_keys SET current_spend_tokens = 100000000 WHERE id = "vk-mercury"').run();

    // Now exceeds one-shot grant limit
    const resExceeded = await app.request('/v1/models', {
      headers: { 'Authorization': `Bearer ${vk.fullKey}` },
    });
    expect(resExceeded.status).toBe(429);
    const body: any = await resExceeded.json();
    expect(body.error.message).toContain('One-shot token limit reached (100,000,000 / 100,000,000 tokens)');
  });

  it('resets daily token spend when 24h passes', async () => {
    const db = getDatabase();
    const now = Date.now();
    const yesterday = now - 25 * 3600 * 1000;
    const vk = generateVirtualKey();

    // Key had exhausted its daily limit yesterday
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm,
        budget_type, budget_cadence, budget_limit, budget_monthly_usd,
        current_spend_usd, current_spend_tokens, spend_reset_at,
        allowed_pools, allowed_models, is_active, created_at, updated_at
      ) VALUES (
        'vk-daily-reset', 'Daily Reset Key', ?, ?, 0,
        'tokens', 'daily', 250000, 0,
        0, 250000, ?,
        NULL, NULL, 1, ?, ?
      )
    `).run(vk.keyHash, vk.keyPrefix, yesterday, yesterday, yesterday);

    // Sending request after reset time should automatically reset tokens to 0 and allow request
    const res = await app.request('/v1/models', {
      headers: { 'Authorization': `Bearer ${vk.fullKey}` },
    });
    expect(res.status).toBe(200);

    const updated = db.query('SELECT current_spend_tokens, spend_reset_at FROM virtual_keys WHERE id = "vk-daily-reset"').get() as any;
    expect(updated.current_spend_tokens).toBe(0);
    expect(updated.spend_reset_at).toBeGreaterThan(now);
  });
});
