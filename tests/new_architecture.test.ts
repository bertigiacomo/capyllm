import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { app } from '../src/index';
import { initDatabase } from '../src/db';
import { encryptSecret, generateVirtualKey, sanitizeErrorMessage, maskKey } from '../src/crypto';
import { clearRoundRobinCounters } from '../src/engine/pool';

describe('New Architecture: Inference Pools, Cascaded Limits & Dynamic Schemas', () => {
  let db: any;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    db = initDatabase(':memory:');
    clearRoundRobinCounters();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('enforces that maskKey never exposes any initial or trailing digits', () => {
    const key = 'sk-proj-1234567890abcdef1234567890abcdef';
    const masked = maskKey(key);
    expect(masked).toBe('••••••••••••');
    expect(masked).not.toContain('sk-');
    expect(masked).not.toContain('cdef');
  });

  it('redacts raw API keys from any error message', () => {
    const errorText = 'Incorrect API key provided: sk-proj-supersecretkey1234. Please check https://platform.openai.com';
    const clean = sanitizeErrorMessage(errorText);
    expect(clean).not.toContain('sk-proj-');
    expect(clean).toContain('[RISERVATO]');
  });

  it('executes priority-based failover within a Pool (Priority 0 -> Priority 1)', async () => {
    const now = Date.now();

    // 1. Create an explicit Pool (Pool B)
    db.query(`
      INSERT INTO pools (id, name, description, budget_type, budget_cadence, budget_limit, created_at, updated_at)
      VALUES ('pool-b', 'Applicazione B', 'Pool for App B with failover', 'tokens', 'daily', 1000000, ?, ?)
    `).run(now, now);

    // 2. Create Upstream Key 1 (OpenAI Primary, priority 0 in pool)
    const encKey1 = encryptSecret('sk-openai-primary-key');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        daily_token_limit, current_daily_tokens, cooldown_until, fail_count,
        api_schema, created_at, updated_at
      ) VALUES ('key-openai', 'openai', 'OpenAI Main (2.5M)', 'https://mock.openai.com/v1', ?, 1, 2500000, 0, 0, 0, 'chat_completions', ?, ?)
    `).run(encKey1, now, now);

    // 3. Create Upstream Key 2 (OpenRouter Fallback, priority 1 in pool)
    const encKey2 = encryptSecret('sk-openrouter-fallback-key');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        daily_token_limit, current_daily_tokens, cooldown_until, fail_count,
        api_schema, created_at, updated_at
      ) VALUES ('key-openrouter', 'openrouter', 'OpenRouter Free Backup', 'https://mock.openrouter.com/v1', ?, 1, 0, 0, 0, 0, 'chat_completions', ?, ?)
    `).run(encKey2, now, now);

    // 4. Configure routes in pool_routes: Priority 0 for OpenAI, Priority 1 for OpenRouter
    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-1', 'pool-b', 'key-openai', 0, '*', ?),
             ('route-2', 'pool-b', 'key-openrouter', 1, '*', ?)
    `).run(now, now);

    // 5. Create CapyKey strictly bound to pool-b
    const generated = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, budget_type, budget_cadence, budget_limit, is_active, created_at, updated_at
      ) VALUES ('vk-app-b', 'Applicazione B Client', ?, ?, 'pool-b', 'tokens', 'daily', 500000, 1, ?, ?)
    `).run(generated.keyHash, generated.keyPrefix, now, now);

    // Mock fetch: when called with OpenAI, simulate 429 Rate Limit; when called with OpenRouter, return 200 OK
    const attemptedUrls: string[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      attemptedUrls.push(url.toString());
      if (url.toString().includes('mock.openai.com')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
          status: 429,
          headers: { 'retry-after': '60' },
        });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{ message: { role: 'assistant', content: 'Response from OpenRouter Fallback!' } }],
        usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${generated.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello fallback' }],
      }),
    });

    expect(res.status).toBe(200);
    // Verifies that OpenAI (Priority 0) was attempted first, and OpenRouter (Priority 1) took over
    expect(attemptedUrls[0]).toContain('mock.openai.com');
    expect(attemptedUrls[1]).toContain('mock.openrouter.com');

    // Verifies response headers confirm the fallback provider and pool
    expect(res.headers.get('x-capyllm-upstream-provider')).toBe('openrouter');
    expect(res.headers.get('x-capyllm-pool')).toBe('pool-b');
  });

  it('enforces pool-level budget hard-stop even when upstream key still has quota', async () => {
    const now = Date.now();

    // Pool limit set to 1,000 tokens, current spend 1,200 tokens (exhausted)
    db.query(`
      INSERT INTO pools (
        id, name, description, budget_type, budget_cadence, budget_limit, current_spend_tokens, created_at, updated_at
      ) VALUES ('pool-capped', 'App Capped', 'Pool over budget', 'tokens', 'daily', 1000, 1200, ?, ?)
    `).run(now, now);

    // Upstream key has 2,500,000 token limit with only 0 tokens used
    const encKey = encryptSecret('sk-plenty-of-tokens');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, daily_token_limit, current_daily_tokens, cooldown_until, fail_count, created_at, updated_at
      ) VALUES ('key-plenty', 'openai', 'OpenAI 2.5M Key', 'https://mock.openai.com/v1', ?, 1, 2500000, 0, 0, 0, ?, ?)
    `).run(encKey, now, now);

    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-cap', 'pool-capped', 'key-plenty', 0, '*', ?)
    `).run(now);

    const generated = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, is_active, created_at, updated_at
      ) VALUES ('vk-cap', 'Capped Client', ?, ?, 'pool-capped', 1, ?, ?)
    `).run(generated.keyHash, generated.keyPrefix, now, now);

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${generated.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Check cap' }],
      }),
    });

    // Pool limit triggers first!
    expect(res.status).toBe(429);
    const body: any = await res.json();
    expect(body.error.code).toBe('pool_budget_exhausted');
    expect(body.error.message).toContain('limit of 1,000 tokens exhausted');
  });

  it('supports custom JSON schema transformations for reasoning parameter renames', async () => {
    const now = Date.now();

    db.query(`
      INSERT INTO pools (id, name, created_at, updated_at)
      VALUES ('pool-custom', 'Custom Schema Pool', ?, ?)
    `).run(now, now);

    // Upstream key with custom schema mapping: reasoning_effort -> thinking_effort
    const customConfig = JSON.stringify({
      param_renames: {
        reasoning_effort: 'thinking_effort',
      },
      header_overrides: {
        'X-Custom-Engine': 'NextGen-Reasoner',
      },
    });

    const encKey = encryptSecret('sk-custom-secret');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        api_schema, custom_schema_config, created_at, updated_at
      ) VALUES ('key-custom', 'custom', 'Custom Model Endpoint', 'https://mock.custom.ai/v1', ?, 1, 'custom', ?, ?, ?)
    `).run(encKey, customConfig, now, now);

    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-cust', 'pool-custom', 'key-custom', 0, '*', ?)
    `).run(now);

    const generated = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, is_active, created_at, updated_at
      ) VALUES ('vk-cust', 'Custom Client', ?, ?, 'pool-custom', 1, ?, ?)
    `).run(generated.keyHash, generated.keyPrefix, now, now);

    let receivedBody: any = null;
    let receivedCustomHeader: string | null = null;

    globalThis.fetch = (async (url: any, init: any) => {
      receivedBody = JSON.parse(init.body);
      receivedCustomHeader = init.headers['X-Custom-Engine'] || null;
      return new Response(JSON.stringify({
        id: 'chatcmpl-custom',
        choices: [{ message: { role: 'assistant', content: 'Reasoned answer' } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${generated.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        reasoning_effort: 'high',
        messages: [{ role: 'user', content: 'Complex logic problem' }],
      }),
    });

    expect(res.status).toBe(200);
    // Verifies the parameter was renamed cleanly from reasoning_effort to thinking_effort according to user-defined JSON schema
    expect(receivedBody.reasoning_effort).toBeUndefined();
    expect(receivedBody.thinking_effort).toBe('high');
    expect(receivedCustomHeader).toBe('NextGen-Reasoner');
  });

  it('aggregates models catalog grouped by model tag across multiple providers with per-provider rates', async () => {
    const now = Date.now();

    // Key 1: OpenAI offers gpt-4o and gpt-4o-mini
    const enc1 = encryptSecret('sk-openai-1');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, is_free_tier, discovered_models, created_at, updated_at
      ) VALUES ('k-openai', 'openai', 'OpenAI Platform', 'https://api.openai.com/v1', ?, 1, 0, ?, ?, ?)
    `).run(enc1, JSON.stringify(['gpt-4o', 'gpt-4o-mini']), now, now);

    // Key 2: OpenRouter offers gpt-4o (free) and claude-3-5-sonnet
    const enc2 = encryptSecret('sk-openrouter-2');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, is_free_tier, discovered_models, created_at, updated_at
      ) VALUES ('k-openrouter', 'openrouter', 'OpenRouter Free', 'https://openrouter.ai/api/v1', ?, 1, 1, ?, ?, ?)
    `).run(enc2, JSON.stringify(['gpt-4o', 'claude-3-5-sonnet']), now, now);

    // Custom pricing for OpenAI gpt-4o
    db.query(`
      INSERT INTO model_pricing (
        id, model, provider, prompt_price_per_1m, completion_price_per_1m, created_at, updated_at
      ) VALUES ('rule-gpt4o', 'gpt-4o', 'openai', 2.5, 10.0, ?, ?)
    `).run(now, now);

    // Create admin session cookie
    const { createTestSessionCookie } = await import('../src/auth/session');
    const adminCookie = await createTestSessionCookie({
      userId: 'admin-1',
      email: 'admin@capyllm.ai',
      role: 'admin',
      createdAt: now,
    });

    const res = await app.request('/api/admin/models-catalog', {
      headers: {
        'Cookie': adminCookie,
      },
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.catalog).toBeDefined();

    // Look for gpt-4o: it should have 2 providers (openai and openrouter)
    const gpt4oEntry = data.catalog.find((c: any) => c.model === 'gpt-4o');
    expect(gpt4oEntry).toBeDefined();
    expect(gpt4oEntry.providers.length).toBe(2);

    const openaiProv = gpt4oEntry.providers.find((p: any) => p.provider === 'openai');
    const openrouterProv = gpt4oEntry.providers.find((p: any) => p.provider === 'openrouter');

    expect(openaiProv.prompt_price_per_1m).toBe(2.5);
    expect(openrouterProv.is_free_tier).toBe(true);
    expect(openrouterProv.prompt_price_per_1m).toBe(0);
  });

  it('provides detailed model statistics breakdown with /api/admin/stats/model/:model', async () => {
    const now = Date.now();

    // Insert an upstream key and a virtual key
    const enc = encryptSecret('sk-test');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at
      ) VALUES ('key-m1', 'openai', 'OpenAI Main', 'https://api.openai.com/v1', ?, 1, ?, ?)
    `).run(enc, now, now);

    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, created_at, updated_at
      ) VALUES ('vkey-m1', 'App Bot', 'hash-1', 'capy_live_123456', ?, ?)
    `).run(now, now);

    // Insert request logs for 'gpt-4o'
    db.query(`
      INSERT INTO request_logs (
        id, virtual_key_id, upstream_key_id, pool_id, provider, model,
        prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, ttft_ms,
        status_code, streamed, aborted, endpoint, created_at
      ) VALUES
      ('log-m1', 'vkey-m1', 'key-m1', 'pool-1', 'openai', 'gpt-4o', 100, 50, 150, 0.001, 350, 120, 200, 1, 0, '/v1/chat/completions', ?),
      ('log-m2', 'vkey-m1', NULL, 'pool-1', 'openrouter', 'gpt-4o', 200, 80, 280, 0.000, 480, 160, 200, 1, 0, '/v1/chat/completions', ?),
      ('log-m3', NULL, 'key-m1', 'pool-1', 'openai', 'gpt-4o', 50, 20, 70, 0.0005, 300, 110, 429, 0, 0, '/v1/chat/completions', ?)
    `).run(now, now, now);

    const { createTestSessionCookie } = await import('../src/auth/session');
    const adminCookie = await createTestSessionCookie({
      userId: 'admin-1',
      email: 'admin@capyllm.ai',
      role: 'admin',
      createdAt: now,
    });

    const res = await app.request('/api/admin/stats/model/gpt-4o', {
      headers: {
        'Cookie': adminCookie,
      },
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.model).toBe('gpt-4o');
    expect(data.total_requests).toBe(3);
    expect(data.total_tokens).toBe(500);
    expect(data.total_prompt_tokens).toBe(350);
    expect(data.total_completion_tokens).toBe(150);
    expect(data.error_count).toBe(1);
    expect(data.by_provider.length).toBe(2);

    const openaiEntry = data.by_provider.find((p: any) => p.provider === 'openai');
    const openrouterEntry = data.by_provider.find((p: any) => p.provider === 'openrouter');

    expect(openaiEntry).toBeDefined();
    expect(openaiEntry.requests).toBe(2);
    expect(openaiEntry.error_count).toBe(1);
    expect(openrouterEntry.requests).toBe(1);
    expect(openrouterEntry.error_count).toBe(0);
  });

  it('enforces route-level model token limits within a pool and fails over to secondary route', async () => {
    const now = Date.now();

    // 1. Create a Pool
    db.query(`
      INSERT INTO pools (id, name, description, budget_type, budget_cadence, budget_limit, created_at, updated_at)
      VALUES ('pool-multi-route', 'Multi-Route Pool', 'Test route limits', 'tokens', 'daily', 0, ?, ?)
    `).run(now, now);

    // 2. Create Upstream Key 1 (Primary, e.g. OpenAI)
    const enc1 = encryptSecret('sk-route-primary');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        daily_token_limit, current_daily_tokens, cooldown_until, fail_count,
        api_schema, created_at, updated_at
      ) VALUES ('key-primary', 'openai', 'OpenAI Primary', 'https://mock.primary.com/v1', ?, 1, 0, 0, 0, 0, 'chat_completions', ?, ?)
    `).run(enc1, now, now);

    // 3. Create Upstream Key 2 (Backup, e.g. OpenRouter)
    const enc2 = encryptSecret('sk-route-backup');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        daily_token_limit, current_daily_tokens, cooldown_until, fail_count,
        api_schema, created_at, updated_at
      ) VALUES ('key-backup', 'openrouter', 'OpenRouter Backup', 'https://mock.backup.com/v1', ?, 1, 0, 0, 0, 0, 'chat_completions', ?, ?)
    `).run(enc2, now, now);

    // 4. Configure routes:
    // Route A: Primary key for gpt-4o with limit = 100 tokens (Priority 0)
    // Route B: Backup key for gpt-4o unlimited (Priority 1)
    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, token_limit, current_tokens, created_at)
      VALUES ('route-p0-gpt4o', 'pool-multi-route', 'key-primary', 0, 'gpt-4o', 100, 0, ?),
             ('route-p1-gpt4o', 'pool-multi-route', 'key-backup', 1, 'gpt-4o', 0, 0, ?)
    `).run(now, now);

    // 5. Create CapyKey
    const generated = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, is_active, created_at, updated_at
      ) VALUES ('vk-multi-route', 'Test App', ?, ?, 'pool-multi-route', 1, ?, ?)
    `).run(generated.keyHash, generated.keyPrefix, now, now);

    const calledHosts: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const u = url.toString();
      calledHosts.push(u);
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{ message: { role: 'assistant', content: 'Success' } }],
        usage: { prompt_tokens: 40, completion_tokens: 70, total_tokens: 110 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    // First call: should hit primary (route-p0-gpt4o, limit 100, current 0)
    const res1 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${generated.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(res1.status).toBe(200);
    expect(calledHosts[0]).toContain('mock.primary.com');

    // Route A consumed 110 tokens, exceeding its limit of 100 tokens!
    const routeCheck: any = db.query('SELECT current_tokens FROM pool_routes WHERE id = ?').get('route-p0-gpt4o');
    expect(routeCheck.current_tokens).toBe(110);

    // Second call for gpt-4o: route-p0-gpt4o is exhausted (110 >= 100), so pool should route to route-p1-gpt4o (backup)
    calledHosts.length = 0;
    const res2 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${generated.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi again' }],
      }),
    });

    expect(res2.status).toBe(200);
    expect(calledHosts[0]).toContain('mock.backup.com');

    // Reset Route A spend via admin endpoint
    const { createTestSessionCookie } = await import('../src/auth/session');
    const adminCookie = await createTestSessionCookie({
      userId: 'admin-1',
      email: 'admin@capyllm.ai',
      role: 'admin',
      createdAt: now,
    });

    const resetRes = await app.request('/api/admin/pools/pool-multi-route/routes/route-p0-gpt4o/reset', {
      method: 'POST',
      headers: { 'Cookie': adminCookie },
    });
    expect(resetRes.status).toBe(200);

    const routeAfterReset: any = db.query('SELECT current_tokens FROM pool_routes WHERE id = ?').get('route-p0-gpt4o');
    expect(routeAfterReset.current_tokens).toBe(0);

    // Third call: with route-p0-gpt4o reset, primary is selected again
    calledHosts.length = 0;
    const res3 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${generated.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Third call' }],
      }),
    });

    expect(res3.status).toBe(200);
    expect(calledHosts[0]).toContain('mock.primary.com');
  });

  it('strictly isolates model wildcards so gpt-4o never matches gpt-4o-mini', async () => {
    const { matchModelPattern } = await import('../src/engine/pool');
    // Exact match
    expect(matchModelPattern('gpt-4o', 'gpt-4o')).toBe(true);
    // Strictness: gpt-4o pattern MUST NOT match gpt-4o-mini
    expect(matchModelPattern('gpt-4o', 'gpt-4o-mini')).toBe(false);
    expect(matchModelPattern('gpt-4', 'gpt-4o')).toBe(false);

    // Prefix wildcard
    expect(matchModelPattern('gpt-4*', 'gpt-4o')).toBe(true);
    expect(matchModelPattern('gpt-4*', 'gpt-4o-mini')).toBe(true);
    expect(matchModelPattern('gpt-4*', 'claude-3-5-sonnet')).toBe(false);

    // Suffix wildcard
    expect(matchModelPattern('*-mini', 'gpt-4o-mini')).toBe(true);
    expect(matchModelPattern('*-mini', 'o3-mini')).toBe(true);
    expect(matchModelPattern('*-mini', 'gpt-4o')).toBe(false);

    // Global wildcard
    expect(matchModelPattern('*', 'anything')).toBe(true);
  });

  it('protects against prototype pollution in custom schema mappings', async () => {
    const { transformPayloadForUpstream } = await import('../src/engine/pool');
    const maliciousKey: any = {
      id: 'k-malicious',
      name: 'Malicious Key',
      provider: 'custom',
      base_url: 'https://api.example.com',
      custom_schema: JSON.stringify({
        body_transforms: {
          '__proto__.polluted': 'hacked',
          'constructor.prototype.evil': 'exploit',
        },
      }),
    };

    const initialBody = { model: 'gpt-4o', messages: [] };
    const transformed = transformPayloadForUpstream(initialBody, maliciousKey);
    expect(transformed).toBeDefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect((Object.prototype as any).evil).toBeUndefined();
  });

  it('rejects negative days in /api/admin/system/clear-logs with 400', async () => {
    const now = Date.now();
    const { createTestSessionCookie } = await import('../src/auth/session');
    const adminCookie = await createTestSessionCookie({
      userId: 'admin-1',
      email: 'admin@capyllm.ai',
      role: 'admin',
      createdAt: now,
    });

    const res = await app.request('/api/admin/system/clear-logs', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ days: -5 }),
    });

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toContain('negative');
  });

  it('returns 404 for non-existent model in GET /v1/models/:model', async () => {
    const { generateVirtualKey } = await import('../src/crypto');
    const gen = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (id, key_prefix, key_hash, name, is_active, created_at, updated_at)
      VALUES ('vk-model-test', ?, ?, 'Model Test Key', 1, ?, ?)
    `).run(gen.keyPrefix, gen.keyHash, Date.now(), Date.now());

    const res = await app.request('/v1/models/non-existent-super-model-xyz', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${gen.fullKey}`,
      },
    });

    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe('model_not_found');
  });

  it('resolves actual model from upstream router (e.g. openrouter/free) in response and logs', async () => {
    const now = Date.now();
    db.query(`
      INSERT INTO pools (id, name, created_at, updated_at)
      VALUES ('pool-router-test', 'Router Pool', ?, ?)
    `).run(now, now);

    const encKey = encryptSecret('sk-openrouter-free-test');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at
      ) VALUES ('key-openrouter-free', 'openrouter', 'OpenRouter Free Key', 'https://mock.openrouter.ai/v1', ?, 1, ?, ?)
    `).run(encKey, now, now);

    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-or-free', 'pool-router-test', 'key-openrouter-free', 0, '*', ?)
    `).run(now);

    const gen = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, is_active, include_metadata, created_at, updated_at
      ) VALUES ('vk-router-test', 'Router App', ?, ?, 'pool-router-test', 1, 1, ?, ?)
    `).run(gen.keyHash, gen.keyPrefix, now, now);

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        id: 'gen-or-123',
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        choices: [{ message: { role: 'assistant', content: 'Free inference response' } }],
        usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gen.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.capy_meta).toBeDefined();
    expect(json.capy_meta.requested_model).toBe('openrouter/free');
    expect(json.capy_meta.resolved_model).toBe('meta-llama/llama-3.3-70b-instruct:free');

    // Verify request_logs has the resolved model recorded
    const logged: any = db.query(`
      SELECT * FROM request_logs WHERE virtual_key_id = 'vk-router-test' ORDER BY id DESC LIMIT 1
    `).get();
    expect(logged).toBeDefined();
    expect(logged.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(logged.status_code).toBe(200);
  });

  it('logs failed upstream attempts and provides failover_history when failover succeeds', async () => {
    const now = Date.now();
    db.query(`
      INSERT INTO pools (id, name, created_at, updated_at)
      VALUES ('pool-failover-log', 'Failover Log Pool', ?, ?)
    `).run(now, now);

    const encKey1 = encryptSecret('sk-primary-failing');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at
      ) VALUES ('key-fail-p0', 'openrouter', 'Primary OpenRouter', 'https://mock.p0.ai/v1', ?, 1, ?, ?)
    `).run(encKey1, now, now);

    const encKey2 = encryptSecret('sk-secondary-backup');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at
      ) VALUES ('key-fail-p1', 'openai', 'Backup OpenAI', 'https://mock.p1.ai/v1', ?, 1, ?, ?)
    `).run(encKey2, now, now);

    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-f-p0', 'pool-failover-log', 'key-fail-p0', 0, '*', ?)
    `).run(now);

    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-f-p1', 'pool-failover-log', 'key-fail-p1', 1, '*', ?)
    `).run(now);

    const gen = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, is_active, include_metadata, created_at, updated_at
      ) VALUES ('vk-fail-test', 'Failover App', ?, ?, 'pool-failover-log', 1, 1, ?, ?)
    `).run(gen.keyHash, gen.keyPrefix, now, now);

    let callCount = 0;
    globalThis.fetch = (async (url: any) => {
      callCount++;
      if (url.includes('mock.p0.ai')) {
        return new Response(JSON.stringify({
          error: { message: 'Provider rate limit exceeded. Capacity exhausted on free tier.' },
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl-backup-ok',
        model: 'gpt-4o-mini',
        choices: [{ message: { role: 'assistant', content: 'Backup succeeded!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gen.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: 'Test failover' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
    const json: any = await res.json();
    expect(json.capy_meta).toBeDefined();
    expect(json.capy_meta.failover).toBe(true);
    expect(Array.isArray(json.capy_meta.failover_history)).toBe(true);
    expect(json.capy_meta.failover_history.length).toBe(1);
    expect(json.capy_meta.failover_history[0].provider).toBe('openrouter');
    expect(json.capy_meta.failover_history[0].status_code).toBe(429);
    expect(json.capy_meta.failover_history[0].reason).toContain('Capacity exhausted');

    // Verify BOTH the failed attempt and successful attempt were recorded in request_logs
    const logs: any[] = db.query(`
      SELECT * FROM request_logs WHERE virtual_key_id = 'vk-fail-test' ORDER BY rowid ASC
    `).all();
    expect(logs.length).toBe(2);
    expect(logs[0].status_code).toBe(429);
    expect(logs[0].error_message).toContain('Capacity exhausted');
    expect(logs[1].status_code).toBe(200);
    expect(logs[1].provider).toBe('openai');
  });

  it('omits capy_meta when CapyKey has include_metadata = 0 for strict vanilla OpenAI clients', async () => {
    const now = Date.now();
    db.query(`
      INSERT INTO pools (id, name, created_at, updated_at)
      VALUES ('pool-vanilla', 'Vanilla Pool', ?, ?)
    `).run(now, now);

    const encKey = encryptSecret('sk-vanilla-secret');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at
      ) VALUES ('key-vanilla', 'openai', 'Vanilla Key', 'https://mock.vanilla.ai/v1', ?, 1, ?, ?)
    `).run(encKey, now, now);

    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-vanilla', 'pool-vanilla', 'key-vanilla', 0, '*', ?)
    `).run(now);

    const gen = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, is_active, include_metadata, created_at, updated_at
      ) VALUES ('vk-vanilla', 'Vanilla Strict App', ?, ?, 'pool-vanilla', 1, 0, ?, ?)
    `).run(gen.keyHash, gen.keyPrefix, now, now);

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        id: 'chatcmpl-vanilla-123',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'Pure vanilla response' } }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gen.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Vanilla check' }],
      }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    // capy_meta MUST NOT exist!
    expect(json.capy_meta).toBeUndefined();
    expect(json.id).toBe('chatcmpl-vanilla-123');
    expect(json.choices[0].message.content).toBe('Pure vanilla response');
  });

  it('resolves actual model in SSE streaming mode from upstream router and logs it', async () => {
    const now = Date.now();
    db.query(`
      INSERT INTO pools (id, name, created_at, updated_at)
      VALUES ('pool-stream-router', 'Stream Router Pool', ?, ?)
    `).run(now, now);

    const encKey = encryptSecret('sk-stream-or-secret');
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at
      ) VALUES ('key-stream-or', 'openrouter', 'Stream Router Key', 'https://mock.stream.or.ai/v1', ?, 1, ?, ?)
    `).run(encKey, now, now);

    db.query(`
      INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES ('route-s-or', 'pool-stream-router', 'key-stream-or', 0, '*', ?)
    `).run(now);

    const gen = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, is_active, include_metadata, created_at, updated_at
      ) VALUES ('vk-stream-or', 'Stream Router App', ?, ?, 'pool-stream-router', 1, 1, ?, ?)
    `).run(gen.keyHash, gen.keyPrefix, now, now);

    const sseChunks = [
      `data: {"id":"chatcmpl-stream-1","model":"qwen/qwen-2.5-72b-instruct:free","choices":[{"delta":{"content":"Hello"}}]}\n\n`,
      `data: {"id":"chatcmpl-stream-1","model":"qwen/qwen-2.5-72b-instruct:free","choices":[{"delta":{"content":" world"}}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n`,
      `data: [DONE]\n\n`,
    ];

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gen.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        stream: true,
        messages: [{ role: 'user', content: 'Stream test' }],
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('qwen/qwen-2.5-72b-instruct:free');

    // Verify request_logs recorded the resolved model
    const logged: any = db.query(`
      SELECT * FROM request_logs WHERE virtual_key_id = 'vk-stream-or' ORDER BY rowid DESC LIMIT 1
    `).get();
    expect(logged).toBeDefined();
    expect(logged.model).toBe('qwen/qwen-2.5-72b-instruct:free');
    expect(logged.streamed).toBe(1);
    expect(logged.total_tokens).toBe(10);
  });

  it('filters upstream keys by supported_schemas (e.g. Chat vs Responses vs Embeddings vs Decision)', async () => {
    const { keySupportsSchema, getAvailableKeysForPool } = await import('../src/engine/pool');
    const { encryptSecret } = await import('../src/crypto');

    const now = Date.now();
    // Key A: supports only chat_completions
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        api_schema, supported_schemas, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'chat_completions', ?, ?, ?)
    `).run('key-schema-chat', 'openai', 'OpenAI Chat Only', 'https://api.openai.com/v1', encryptSecret('sk-chat'), JSON.stringify(['chat_completions']), now, now);

    // Key B: supports responses and decision
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        api_schema, supported_schemas, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'responses', ?, ?, ?)
    `).run('key-schema-resp', 'openai', 'OpenAI Resp & Decision', 'https://api.openai.com/v1', encryptSecret('sk-resp'), JSON.stringify(['responses', 'decision']), now, now);

    // Key C: supports all via wildcard *
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        api_schema, supported_schemas, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'custom', ?, ?, ?)
    `).run('key-schema-all', 'openrouter', 'OpenRouter All', 'https://openrouter.ai/api/v1', encryptSecret('sk-all'), JSON.stringify(['*']), now, now);

    // Create pool and routes for all 3
    db.query(`INSERT INTO pools (id, name, created_at, updated_at) VALUES ('pool-schema-test', 'Pool Schemas', ?, ?)`).run(now, now);
    db.query(`INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES ('r-sc-1', 'pool-schema-test', 'key-schema-chat', 0, '*', ?)`).run(now);
    db.query(`INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES ('r-sc-2', 'pool-schema-test', 'key-schema-resp', 1, '*', ?)`).run(now);
    db.query(`INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES ('r-sc-3', 'pool-schema-test', 'key-schema-all', 2, '*', ?)`).run(now);

    // 1. Chat completions request: key-schema-chat and key-schema-all match, key-schema-resp is excluded
    const chatKeys = getAvailableKeysForPool('pool-schema-test', '*', 'chat_completions');
    const chatKeyIds = chatKeys.map((k) => k.id);
    expect(chatKeyIds).toContain('key-schema-chat');
    expect(chatKeyIds).toContain('key-schema-all');
    expect(chatKeyIds).not.toContain('key-schema-resp');

    // 2. Responses request: key-schema-resp and key-schema-all match, key-schema-chat is excluded
    const respKeys = getAvailableKeysForPool('pool-schema-test', '*', 'responses');
    const respKeyIds = respKeys.map((k) => k.id);
    expect(respKeyIds).toContain('key-schema-resp');
    expect(respKeyIds).toContain('key-schema-all');
    expect(respKeyIds).not.toContain('key-schema-chat');

    // 3. Embeddings request: only key-schema-all matches
    const embedKeys = getAvailableKeysForPool('pool-schema-test', '*', 'embeddings');
    const embedKeyIds = embedKeys.map((k) => k.id);
    expect(embedKeyIds).toEqual(['key-schema-all']);

    // 4. Decision request: key-schema-resp and key-schema-all match
    const decKeys = getAvailableKeysForPool('pool-schema-test', '*', 'decision');
    const decKeyIds = decKeys.map((k) => k.id);
    expect(decKeyIds).toContain('key-schema-resp');
    expect(decKeyIds).toContain('key-schema-all');
    expect(decKeyIds).not.toContain('key-schema-chat');
  });

  it('integrates Drizzle ORM seamlessly over bun:sqlite with zero performance penalty', async () => {
    const { getDrizzleDb, schema } = await import('../src/db');
    const { eq } = await import('drizzle-orm');

    const drizzleDb = getDrizzleDb();
    expect(drizzleDb).toBeDefined();

    const now = Date.now();
    db.query(`INSERT INTO pools (id, name, created_at, updated_at) VALUES ('pool-drizzle-test', 'Pool Drizzle', ?, ?)`).run(now, now);
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active,
        api_schema, supported_schemas, created_at, updated_at
      ) VALUES ('key-drizzle-chat', 'openai', 'OpenAI Drizzle', 'https://api.openai.com/v1', 'enc-mock', 1, 'chat_completions', '["chat_completions"]', ?, ?)
    `).run(now, now);

    // Query pools using Drizzle ORM
    const drizzlePools = drizzleDb.select().from(schema.pools).where(eq(schema.pools.id, 'pool-drizzle-test')).all();
    expect(drizzlePools.length).toBe(1);
    expect(drizzlePools[0].name).toBe('Pool Drizzle');

    // Query upstream_keys using Drizzle ORM
    const drizzleKeys = drizzleDb.select().from(schema.upstreamKeys).where(eq(schema.upstreamKeys.id, 'key-drizzle-chat')).all();
    expect(drizzleKeys.length).toBe(1);
    expect(drizzleKeys[0].provider).toBe('openai');
    expect(drizzleKeys[0].supported_schemas).toBe('["chat_completions"]');
  });

  it('adapts payload and strips reasoning/temperature parameters based on target model capabilities', async () => {
    const { adaptPayloadForTargetModel, getModelCapabilities } = await import('../src/engine/model_capabilities');

    // 1. Verify capability detection
    const o1Caps = getModelCapabilities('openai', 'o1');
    expect(o1Caps.reasoning).toBe(true);
    expect(o1Caps.temperature).toBe(false);

    const gpt4oCaps = getModelCapabilities('openai', 'gpt-4o');
    expect(gpt4oCaps.reasoning).toBe(false);
    expect(gpt4oCaps.temperature).toBe(true);

    // 2. Falling back to non-reasoning model (e.g. Terra -> Luna / gpt-4o):
    // reasoning_effort must be stripped to prevent OpenAI 400 Bad Request error!
    const originalReq = {
      model: 'o1',
      messages: [{ role: 'user', content: 'solve this' }],
      reasoning_effort: 'high',
      temperature: 1.0,
    };

    const adaptedForGpt4o = adaptPayloadForTargetModel(originalReq, 'gpt-4o', 'openai');
    expect(adaptedForGpt4o.model).toBe('gpt-4o');
    expect(adaptedForGpt4o.reasoning_effort).toBeUndefined(); // stripped!
    expect(adaptedForGpt4o.temperature).toBe(1.0); // kept!

    // 3. Falling back to an o1 model (which rejects temperature):
    const adaptedForO1 = adaptPayloadForTargetModel({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'solve this' }],
      temperature: 0.7,
      reasoning_effort: 'medium',
    }, 'o1', 'openai');
    expect(adaptedForO1.model).toBe('o1');
    expect(adaptedForO1.temperature).toBeUndefined(); // stripped!
    expect(adaptedForO1.reasoning_effort).toBe('medium'); // kept!
  });

  it('executes cross-model fallback in a pool when Resilience mode is enabled (Terra -> Luna)', async () => {
    const { selectKeyFromPool } = await import('../src/engine/pool');
    const { encryptSecret, generateVirtualKey } = await import('../src/crypto');

    const now = Date.now();

    // Key 1: P0 Terra (in cooldown)
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, cooldown_until,
        api_schema, supported_schemas, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, 'chat_completions', '["chat_completions"]', ?, ?)
    `).run('key-terra', 'openai', 'OpenAI Terra', 'https://mock.openai.com/v1', encryptSecret('sk-terra'), now + 60000, now, now);

    // Key 2: P1 Luna (healthy)
    db.query(`
      INSERT INTO upstream_keys (
        id, provider, name, base_url, encrypted_key, is_active, cooldown_until,
        api_schema, supported_schemas, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 0, 'chat_completions', '["chat_completions"]', ?, ?)
    `).run('key-luna', 'openai', 'OpenAI Luna', 'https://mock.openai.com/v1', encryptSecret('sk-luna'), now, now);

    // 1. Pool with allow_cross_model_fallback = 0 (Resilience OFF)
    db.query(`
      INSERT INTO pools (id, name, allow_cross_model_fallback, created_at, updated_at)
      VALUES ('pool-strict', 'Strict Pool', 0, ?, ?)
    `).run(now, now);
    db.query(`INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES ('r-st-0', 'pool-strict', 'key-terra', 0, 'gpt-5.6-terra', ?)`).run(now);
    db.query(`INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES ('r-st-1', 'pool-strict', 'key-luna', 1, 'gpt-5.6-luna', ?)`).run(now);

    // When asking for gpt-5.6-terra and resilience is off, returns null because Terra is cooling down
    const selectedStrict = selectKeyFromPool('pool-strict', new Set(), 'gpt-5.6-terra');
    expect(selectedStrict).toBeNull();

    // 2. Pool with allow_cross_model_fallback = 1 (Resilience ON)
    db.query(`
      INSERT INTO pools (id, name, allow_cross_model_fallback, created_at, updated_at)
      VALUES ('pool-resilient', 'Resilient Pool', 1, ?, ?)
    `).run(now, now);
    db.query(`INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES ('r-res-0', 'pool-resilient', 'key-terra', 0, 'gpt-5.6-terra', ?)`).run(now);
    db.query(`INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES ('r-res-1', 'pool-resilient', 'key-luna', 1, 'gpt-5.6-luna', ?)`).run(now);

    // When asking for gpt-5.6-terra and resilience is on, falls back to Luna!
    const selectedResilient = selectKeyFromPool('pool-resilient', new Set(), 'gpt-5.6-terra');
    expect(selectedResilient).toBeDefined();
    expect(selectedResilient!.key.id).toBe('key-luna');
    expect(selectedResilient!.targetModel).toBe('gpt-5.6-luna');
    expect(selectedResilient!.isCrossModelFallback).toBe(true);

    // 3. Test full relay request with cross-model fallback & parameter adaptation
    const generated = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, pool_id, rate_limit_rpm,
        budget_type, budget_cadence, budget_limit, current_spend_usd, current_spend_tokens,
        spend_reset_at, include_metadata, is_active, created_at, updated_at
      ) VALUES ('vk-resilient', 'Resilience App Key', ?, ?, 'pool-resilient', 0, 'tokens', 'daily', 0, 0, 0, 0, 1, 1, ?, ?)
    `).run(generated.keyHash, generated.keyPrefix, now, now);

    let calledBody: any = null;
    globalThis.fetch = (async (url: string, init: any) => {
      calledBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: 'chatcmpl-fallback-1',
        model: 'gpt-5.6-luna',
        choices: [{ message: { role: 'assistant', content: 'Luna response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${generated.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        messages: [{ role: 'user', content: 'Hello' }],
        reasoning_effort: 'high',
      }),
    });

    expect(res.status).toBe(200);
    const resData: any = await res.json();
    expect(resData.choices[0].message.content).toBe('Luna response');
    // Body sent to provider had model rewritten to gpt-5.6-luna!
    expect(calledBody.model).toBe('gpt-5.6-luna');
    // capy_meta accurately reflects original request vs fallback target
    expect(resData.capy_meta).toBeDefined();
    expect(resData.capy_meta.requested_model).toBe('gpt-5.6-terra');
    expect(resData.capy_meta.resolved_model).toBe('gpt-5.6-luna');
  });
});
