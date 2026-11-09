import { describe, it, expect, beforeEach } from 'bun:test';
import { app } from '../src/index';
import { initDatabase } from '../src/db';
import { generateVirtualKey } from '../src/crypto';
import crypto from 'node:crypto';

describe('Auth & Passkey Endpoints', () => {
  let db: any;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('rejects /api/auth/setup/options with invalid or missing token', async () => {
    const res = await app.request('/api/auth/setup/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'nonexistent-token' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('Invalid or non-existent');
  });

  it('rejects /api/auth/setup/options with empty body via Zod validation', async () => {
    const res = await app.request('/api/auth/setup/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invite token is required');
  });

  it('generates registration options with residentKey required for valid invite', async () => {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.query(`
      INSERT INTO user_invites (id, email, role, token, expires_at, created_at)
      VALUES ('inv-1', 'admin@capyllm.ai', 'admin', ?, ?, ?)
    `).run(token, now + 100000, now);

    const res = await app.request('/api/auth/setup/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.options).toBeDefined();
    expect(json.options.challenge).toBeDefined();
    expect(json.options.authenticatorSelection.residentKey).toBe('required');
    expect(json.email).toBe('admin@capyllm.ai');

    // Verify signed cookie set
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('capy_challenge');
  });

  it('rejects expired invite tokens', async () => {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.query(`
      INSERT INTO user_invites (id, email, role, token, expires_at, created_at)
      VALUES ('inv-expired', 'expired@capyllm.ai', 'user', ?, ?, ?)
    `).run(token, now - 1000, now - 100000);

    const res = await app.request('/api/auth/setup/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('expired');
  });

  it('generates authentication options for 1-click passkey login', async () => {
    const res = await app.request('/api/auth/login/options', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.options).toBeDefined();
    expect(json.options.challenge).toBeDefined();

    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('capy_challenge');
  });

  it('checks /api/auth/me returns unauthenticated when no session present', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authenticated).toBe(false);
    expect(json.user).toBeNull();
  });

  it('automatically resets monthly spend when 30 days elapse', async () => {
    const vk = generateVirtualKey();
    const now = Date.now();
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm, budget_monthly_usd,
        current_spend_usd, spend_reset_at, allowed_pools, allowed_models,
        is_active, created_at, updated_at
      ) VALUES ('vk-reset-test', 'Auto Reset Test', ?, ?, 0, 50.0, 50.0, ?, NULL, NULL, 1, ?, ?)
    `).run(vk.keyHash, vk.keyPrefix, thirtyOneDaysAgo, thirtyOneDaysAgo, thirtyOneDaysAgo);

    // Call /v1/models with the key (which runs requireVirtualKey)
    const res = await app.request('/v1/models', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${vk.fullKey}` },
    });

    expect(res.status).toBe(200);

    // Verify current_spend_usd reset to 0 in SQLite
    const updated = db.query('SELECT current_spend_usd, spend_reset_at FROM virtual_keys WHERE id = "vk-reset-test"').get() as any;
    expect(updated.current_spend_usd).toBe(0);
    expect(updated.spend_reset_at).toBeGreaterThan(thirtyOneDaysAgo);
  });
});
