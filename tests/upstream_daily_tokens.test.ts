import { describe, it, expect, beforeEach } from 'bun:test';
import { getDatabase, initDatabase, calculateNextResetAt } from '../src/db';
import { selectKeyFromPool, getAvailableKeysForPool } from '../src/engine/pool';
import { logRequestAsync } from '../src/engine/logger';
import { encryptSecret } from '../src/crypto';
import crypto from 'node:crypto';

describe('Upstream Key Daily Token Limit & Multi-App Token Pooling', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    process.env.CAPY_MASTER_KEY = 'capy-test-master-key-32chars-ok';
  });

  it('excludes upstream key from selection once its daily token limit is exhausted', () => {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const now = Date.now();
    const tomorrow = calculateNextResetAt('daily', now);

    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active, daily_token_limit, current_daily_tokens, daily_tokens_reset_at, cooldown_until, fail_count, created_at, updated_at
      ) VALUES (?, 'default', 'openai', 'OpenAI Shared 2.5M', 'https://api.openai.com/v1', ?, 1, 2500000, 2490000, ?, 0, 0, ?, ?)
    `).run(id, encryptSecret('sk-test-key'), tomorrow, now, now);

    // Initial state: 2,490,000 tokens used out of 2,500,000 limit -> available
    let available = getAvailableKeysForPool('default');
    expect(available.length).toBe(1);
    expect(available[0].id).toBe(id);

    // Simulate usage passing 2,500,000 tokens
    db.query(`
      UPDATE upstream_keys
      SET current_daily_tokens = 2500001, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);

    // Now key should be excluded because daily limit is reached
    available = getAvailableKeysForPool('default');
    expect(available.length).toBe(0);

    const selected = selectKeyFromPool('default');
    expect(selected).toBeNull();
  });

  it('resets upstream key daily tokens automatically when daily reset timestamp passes', () => {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const now = Date.now();
    const yesterday = now - 1000; // Reset time was in the past

    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active, daily_token_limit, current_daily_tokens, daily_tokens_reset_at, cooldown_until, fail_count, created_at, updated_at
      ) VALUES (?, 'default', 'openai', 'OpenAI Shared 2.5M', 'https://api.openai.com/v1', ?, 1, 2500000, 2500000, ?, 0, 0, ?, ?)
    `).run(id, encryptSecret('sk-test-key'), yesterday, now, now);

    // Calling getAvailableKeysForPool should detect expired reset_at, reset current_daily_tokens to 0, and make it available
    const available = getAvailableKeysForPool('default');
    expect(available.length).toBe(1);
    expect(available[0].current_daily_tokens).toBe(0);
    expect(available[0].daily_tokens_reset_at).toBeGreaterThan(now);
  });
});
