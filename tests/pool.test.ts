import { describe, it, expect, beforeEach } from 'bun:test';
import { initDatabase, getDatabase } from '../src/db';
import { encryptSecret } from '../src/crypto';
import {
  selectKeyFromPool,
  selectKeyFromPools,
  markKeyCooldown,
  markKeySuccess,
  resetKeyCooldown,
  calculateCooldownMs,
  getAvailableKeysForPool,
  clearRoundRobinCounters,
} from '../src/engine/pool';

describe('Upstream Key Pooling & Failover', () => {
  let db: any;

  beforeEach(() => {
    db = initDatabase(':memory:');
    clearRoundRobinCounters();
  });

  it('calculates progressive cooldown and retry-after header', () => {
    // Progressive backoff: 60s, 120s, 300s
    expect(calculateCooldownMs(0)).toBe(60_000);
    expect(calculateCooldownMs(1)).toBe(120_000);
    expect(calculateCooldownMs(2)).toBe(300_000);
    expect(calculateCooldownMs(5)).toBe(300_000);

    // Numeric Retry-After header
    expect(calculateCooldownMs(0, '45')).toBe(45_000);
  });

  it('selects active keys round-robin', () => {
    const key1 = encryptSecret('sk-key-1');
    const key2 = encryptSecret('sk-key-2');
    const now = Date.now();

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES (?, 'default', 'openai', 'Key 1', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run('k1', key1, now, now);

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES (?, 'default', 'openai', 'Key 2', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run('k2', key2, now + 1, now + 1);

    const first = selectKeyFromPool('default');
    const second = selectKeyFromPool('default');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // They should alternate
    expect(first?.key.id).not.toBe(second?.key.id);
  });

  it('marks key in cooldown on 429 and skips it in next selection', () => {
    const key1 = encryptSecret('sk-key-1');
    const key2 = encryptSecret('sk-key-2');
    const now = Date.now();

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES (?, 'default', 'openai', 'Key 1', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run('k1', key1, now, now);

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES (?, 'default', 'openai', 'Key 2', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run('k2', key2, now + 1, now + 1);

    const k1Obj = db.query('SELECT * FROM upstream_keys WHERE id = ?').get('k1');
    markKeyCooldown(k1Obj, '60');

    // Available keys should now only have k2
    const available = getAvailableKeysForPool('default');
    expect(available.length).toBe(1);
    expect(available[0].id).toBe('k2');

    // Selecting from pool should only return k2
    const selected = selectKeyFromPool('default');
    expect(selected?.key.id).toBe('k2');

    // Resetting cooldown should make k1 available again
    resetKeyCooldown('k1');
    const availableAfterReset = getAvailableKeysForPool('default');
    expect(availableAfterReset.length).toBe(2);
  });

  it('handles bad encrypted key gracefully by marking error and skipping', () => {
    const badKey = 'invalid:bad:cipher';
    const goodKey = encryptSecret('sk-good-key');
    const now = Date.now();

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES ('k-bad', 'default', 'openai', 'Bad Key', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run(badKey, now, now);

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES ('k-good', 'default', 'openai', 'Good Key', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run(goodKey, now + 1, now + 1);

    const selected = selectKeyFromPool('default');
    expect(selected).not.toBeNull();
    expect(selected?.key.id).toBe('k-good');
    expect(selected?.apiKey).toBe('sk-good-key');

    // Check that bad key was marked with error
    const badRow = db.query('SELECT * FROM upstream_keys WHERE id = ?').get('k-bad') as any;
    expect(badRow.last_error).toContain('Decryption error');
  });

  it('fails over across pools using selectKeyFromPools when primary pool keys are in cooldown', () => {
    const key1 = encryptSecret('sk-pool1-key');
    const key2 = encryptSecret('sk-pool2-key');
    const now = Date.now();

    db.query(`INSERT INTO pools (id, name, description, created_at, updated_at) VALUES ('fast-pool', 'Fast', '', ?, ?)`).run(now, now);
    db.query(`INSERT INTO pools (id, name, description, created_at, updated_at) VALUES ('fallback-pool', 'Fallback', '', ?, ?)`).run(now, now);

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES ('k-p1', 'fast-pool', 'groq', 'Fast Key', 'https://api.groq.com/openai/v1', ?, 1, ?, ?)
    `).run(key1, now, now);

    db.query(`
      INSERT INTO upstream_keys (id, pool_id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
      VALUES ('k-p2', 'fallback-pool', 'openai', 'Fallback Key', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run(key2, now + 1, now + 1);

    // Initial selection from ['fast-pool', 'fallback-pool'] selects from fast-pool
    const first = selectKeyFromPools(['fast-pool', 'fallback-pool']);
    expect(first?.key.id).toBe('k-p1');

    // Put fast-pool key into cooldown
    const p1Obj = db.query('SELECT * FROM upstream_keys WHERE id = ?').get('k-p1');
    markKeyCooldown(p1Obj, '60');

    // Next selection should automatically failover to fallback-pool
    const second = selectKeyFromPools(['fast-pool', 'fallback-pool']);
    expect(second?.key.id).toBe('k-p2');
    expect(second?.apiKey).toBe('sk-pool2-key');
  });
});
