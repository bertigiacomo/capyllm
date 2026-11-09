import { describe, it, expect, beforeEach } from 'bun:test';
import { app } from '../src/index';
import { initDatabase } from '../src/db';
import { createTestSessionCookie } from '../src/auth/session';

describe('Admin Endpoints & Role Protection', () => {
  let db: any;
  let adminCookie: string;
  let userCookie: string;

  beforeEach(async () => {
    db = initDatabase(':memory:');

    adminCookie = await createTestSessionCookie({
      userId: 'u-admin-1',
      email: 'admin@capyllm.ai',
      role: 'admin',
      createdAt: Date.now(),
    });

    userCookie = await createTestSessionCookie({
      userId: 'u-regular-1',
      email: 'user@capyllm.ai',
      role: 'user',
      createdAt: Date.now(),
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.request('/api/admin/keys');
    expect(res.status).toBe(401);
  });

  it('rejects regular non-admin user with 403', async () => {
    const res = await app.request('/api/admin/keys', {
      headers: {
        'Cookie': userCookie,
      },
    });
    expect(res.status).toBe(403);
  });

  it('allows admin to CRUD upstream keys', async () => {
    // 1. Create upstream key
    const createRes = await app.request('/api/admin/keys', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'groq',
        name: 'Groq Production',
        base_url: 'https://api.groq.com/openai/v1',
        api_key: 'gsk_test1234567890abcdef',
        pool_id: 'default',
      }),
    });

    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.success).toBe(true);
    expect(createJson.key.id).toBeDefined();
    expect(createJson.key.masked_key).toContain('••••');
    const keyId = createJson.key.id;

    // 2. List keys
    const listRes = await app.request('/api/admin/keys', {
      headers: { 'Cookie': adminCookie },
    });
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.keys.length).toBe(1);
    expect(listJson.keys[0].name).toBe('Groq Production');

    // 3. Patch key
    const patchRes = await app.request(`/api/admin/keys/${keyId}`, {
      method: 'PATCH',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Groq High-Speed',
      }),
    });
    expect(patchRes.status).toBe(200);

    // 4. Delete key
    const delRes = await app.request(`/api/admin/keys/${keyId}`, {
      method: 'DELETE',
      headers: { 'Cookie': adminCookie },
    });
    expect(delRes.status).toBe(200);

    const listAfterRes = await app.request('/api/admin/keys', {
      headers: { 'Cookie': adminCookie },
    });
    const listAfterJson = await listAfterRes.json();
    expect(listAfterJson.keys.length).toBe(0);
  });

  it('allows admin to create virtual keys and returns full plaintext key once', async () => {
    const createRes = await app.request('/api/admin/virtual-keys', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'App Client Key',
        budget_monthly_usd: 50.0,
        rate_limit_rpm: 60,
      }),
    });

    expect(createRes.status).toBe(201);
    const json = await createRes.json();
    expect(json.success).toBe(true);
    expect(json.virtual_key.full_key).toMatch(/^capy_live_[a-f0-9]{6}_[a-f0-9]+$/);
    expect(json.virtual_key.key_prefix).toMatch(/^capy_live_[a-f0-9]{6}$/);

    // In listing, full_key must NOT be exposed
    const listRes = await app.request('/api/admin/virtual-keys', {
      headers: { 'Cookie': adminCookie },
    });
    const listJson = await listRes.json();
    expect(listJson.virtual_keys.length).toBe(1);
    expect((listJson.virtual_keys[0] as any).full_key).toBeUndefined();
    expect((listJson.virtual_keys[0] as any).key_hash).toBeUndefined();
    expect(listJson.virtual_keys[0].key_prefix).toBe(json.virtual_key.key_prefix);
  });

  it('returns aggregated stats', async () => {
    const statsRes = await app.request('/api/admin/stats', {
      headers: { 'Cookie': adminCookie },
    });
    expect(statsRes.status).toBe(200);
    const json = await statsRes.json();
    expect(json.total_requests).toBeDefined();
    expect(json.total_spend_usd).toBeDefined();
    expect(json.avg_latency_ms).toBeDefined();
    expect(json.total_keys).toBeDefined();
  });

  it('allows admin to CRUD custom model pricing rules', async () => {
    // 1. Create a pricing rule for gpt-6.1-astra
    const createRes = await app.request('/api/admin/pricing', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-6.1-astra',
        provider: 'openai',
        prompt_price_per_1m: 2.50,
        completion_price_per_1m: 10.00,
      }),
    });

    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.success).toBe(true);
    expect(createJson.rule.model).toBe('gpt-6.1-astra');
    expect(createJson.rule.prompt_price_per_1m).toBe(2.50);
    expect(createJson.rule.completion_price_per_1m).toBe(10.00);

    const ruleId = createJson.rule.id;

    // 2. List pricing rules
    const listRes = await app.request('/api/admin/pricing', {
      headers: { 'Cookie': adminCookie },
    });
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.rules.length).toBe(1);
    expect(listJson.rules[0].id).toBe(ruleId);

    // 3. Update rule
    const updateRes = await app.request(`/api/admin/pricing/${ruleId}`, {
      method: 'PATCH',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt_price_per_1m: 1.80,
      }),
    });
    expect(updateRes.status).toBe(200);

    // 4. Verify updated rule
    const listUpdatedRes = await app.request('/api/admin/pricing', {
      headers: { 'Cookie': adminCookie },
    });
    const listUpdatedJson = await listUpdatedRes.json();
    expect(listUpdatedJson.rules[0].prompt_price_per_1m).toBe(1.80);
    expect(listUpdatedJson.rules[0].completion_price_per_1m).toBe(10.00);

    // 5. Delete rule
    const deleteRes = await app.request(`/api/admin/pricing/${ruleId}`, {
      method: 'DELETE',
      headers: { 'Cookie': adminCookie },
    });
    expect(deleteRes.status).toBe(200);

    const listFinalRes = await app.request('/api/admin/pricing', {
      headers: { 'Cookie': adminCookie },
    });
    const listFinalJson = await listFinalRes.json();
    expect(listFinalJson.rules.length).toBe(0);
  });

  it('provides system info, backup, and logs purge', async () => {
    // 1. System info
    const infoRes = await app.request('/api/admin/system/info', {
      headers: { 'Cookie': adminCookie },
    });
    expect(infoRes.status).toBe(200);
    const info = await infoRes.json();
    expect(info.version).toBe('1.0.0');
    expect(info.bun_version).toBeDefined();
    expect(info.uptime_seconds).toBeGreaterThanOrEqual(0);

    // 2. Clear logs
    const clearRes = await app.request('/api/admin/system/clear-logs', {
      method: 'POST',
      headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 0 }),
    });
    expect(clearRes.status).toBe(200);
    const clearJson = await clearRes.json();
    expect(clearJson.success).toBe(true);

    // 3. System backup
    const backupRes = await app.request('/api/admin/system/backup', {
      headers: { 'Cookie': adminCookie },
    });
    // In :memory: test mode, Bun.file may return 404, which is expected and handled cleanly
    expect([200, 404]).toContain(backupRes.status);
  });

  it('allows upstream key creation with any models.dev provider (e.g. Inception) and unified budget limits', async () => {
    // 1. Create upstream key with provider "Inception" and USD monthly budget
    const createRes = await app.request('/api/admin/keys', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'Inception',
        name: 'Inception Labs Mercury',
        base_url: 'https://api.inceptionlabs.ai/v1',
        api_key: 'inc_test_secret_key_123',
        budget_type: 'usd',
        budget_cadence: 'monthly',
        budget_limit: 50.0,
      }),
    });

    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.success).toBe(true);
    expect(createJson.key.provider).toBe('Inception');
    expect(createJson.key.budget_type).toBe('usd');
    expect(createJson.key.budget_cadence).toBe('monthly');
    expect(createJson.key.budget_limit).toBe(50.0);
    const keyId = createJson.key.id;

    // 2. Verify key appears in GET /api/admin/keys
    const listRes = await app.request('/api/admin/keys', {
      headers: { 'Cookie': adminCookie },
    });
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    const createdKey = listJson.keys.find((k: any) => k.id === keyId);
    expect(createdKey).toBeDefined();
    expect(createdKey.provider).toBe('Inception');
    expect(createdKey.budget_limit).toBe(50.0);

    // 3. Update unified budget on key
    const patchRes = await app.request(`/api/admin/keys/${keyId}`, {
      method: 'PATCH',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        budget_type: 'tokens',
        budget_cadence: 'weekly',
        budget_limit: 2000000,
      }),
    });
    expect(patchRes.status).toBe(200);
  });

  it('provides system settings GET and POST for configurable reset hour with server time', async () => {
    // 1. Initial GET
    const getRes = await app.request('/api/admin/system/settings', {
      headers: { 'Cookie': adminCookie },
    });
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.daily_reset_hour).toBe(0);
    expect(getJson.server_time).toBeDefined();
    expect(getJson.server_timezone).toBeDefined();

    // 2. Update reset hour to 4 (04:00)
    const postRes = await app.request('/api/admin/system/settings', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ daily_reset_hour: 4 }),
    });
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.success).toBe(true);
    expect(postJson.daily_reset_hour).toBe(4);

    // 3. Verify GET reflects 4
    const getAfterRes = await app.request('/api/admin/system/settings', {
      headers: { 'Cookie': adminCookie },
    });
    const getAfterJson = await getAfterRes.json();
    expect(getAfterJson.daily_reset_hour).toBe(4);

    // 4. Reject invalid hour (e.g. 25)
    const errRes = await app.request('/api/admin/system/settings', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ daily_reset_hour: 25 }),
    });
    expect(errRes.status).toBe(400);
  });
});
