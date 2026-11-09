import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { app } from '../src/index';
import { initDatabase } from '../src/db';
import { encryptSecret, generateVirtualKey } from '../src/crypto';
import { clearRoundRobinCounters } from '../src/engine/pool';

describe('OpenAI Relay Engine & Failover', () => {
  let db: any;
  let virtualKey: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    db = initDatabase(':memory:');
    clearRoundRobinCounters();

    // Create a virtual key
    const vk = generateVirtualKey();
    virtualKey = vk.fullKey;
    const now = Date.now();

    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm, budget_monthly_usd,
        current_spend_usd, spend_reset_at, allowed_pools, allowed_models,
        is_active, created_at, updated_at
      ) VALUES ('vk-test', 'Test Key', ?, ?, 0, 100, 0, ?, NULL, NULL, 1, ?, ?)
    `).run(vk.keyHash, vk.keyPrefix, now, now, now);

    // Create an upstream key
    const encKey = encryptSecret('sk-upstream-secret-123');
    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active,
        cooldown_until, fail_count, last_error, created_at, updated_at
      ) VALUES ('k-up-1', 'default', 'openai', 'OpenAI Main', 'https://mock.api.com/v1', ?, 1, 0, 0, NULL, ?, ?)
    `).run(encKey, now, now);

    // Set pricing rule for gpt-4o
    db.query(`
      INSERT INTO model_pricing (
        id, model, provider, upstream_key_id, capy_key_id,
        prompt_price_per_1m, completion_price_per_1m, created_at, updated_at
      ) VALUES ('p-1', 'gpt-4o', 'openai', NULL, NULL, 2.5, 10.0, ?, ?)
    `).run(now, now);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('relays non-streaming completions and injects capy_meta', async () => {
    globalThis.fetch = (async (url: any, init: any) => {
      expect(url.toString()).toBe('https://mock.api.com/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer sk-upstream-secret-123');

      const body = JSON.parse(init.body);
      expect(body.model).toBe('gpt-4o');

      return new Response(JSON.stringify({
        id: 'chatcmpl-test-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello from CapyLLM test!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-capy-key-id')).toBe('k-up-1');
    expect(res.headers.get('x-capy-provider')).toBe('openai');
    expect(res.headers.get('x-capy-latency-ms')).toBeDefined();

    const json = await res.json();
    expect(json.choices[0].message.content).toBe('Hello from CapyLLM test!');
    // Verify capy_meta injection
    expect(json.capy_meta).toBeDefined();
    expect(json.capy_meta.key_id).toBe('k-up-1');
    expect(json.capy_meta.provider).toBe('openai');
    expect(json.capy_meta.cost_usd).toBeGreaterThan(0);
  });

  it('fails over to next key on HTTP 429 and applies cooldown', async () => {
    const encKey2 = encryptSecret('sk-upstream-secret-456');
    const now = Date.now();
    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active,
        cooldown_until, fail_count, last_error, created_at, updated_at
      ) VALUES ('k-up-2', 'default', 'groq', 'Groq Fallback', 'https://mock.groq.com/v1', ?, 1, 0, 0, NULL, ?, ?)
    `).run(encKey2, now + 1, now + 1);

    let callCount = 0;
    globalThis.fetch = (async (url: any, init: any) => {
      callCount++;
      if (callCount === 1) {
        // First key returns 429 Too Many Requests
        return new Response(JSON.stringify({ error: 'rate limited' }), {
          status: 429,
          headers: { 'retry-after': '30' },
        });
      }

      // Second key succeeds
      return new Response(JSON.stringify({
        id: 'chatcmpl-fallback',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'Fallback success' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Test failover' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-capy-key-id')).toBe('k-up-2');
    expect(res.headers.get('x-capy-provider')).toBe('groq');

    const json = await res.json();
    expect(json.choices[0].message.content).toBe('Fallback success');

    // Verify key 1 was put in cooldown
    const k1 = db.query('SELECT * FROM upstream_keys WHERE id = ?').get('k-up-1') as any;
    expect(k1.cooldown_until).toBeGreaterThan(Date.now());
    expect(k1.fail_count).toBe(1);
  });

  it('injects stream_options in streaming mode, provides x-capy-latency-ms and pipes SSE', async () => {
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedBody = JSON.parse(init.body);

      // Return SSE stream
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Capy"}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"bara"}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
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
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say capybara' }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('x-capy-key-id')).toBe('k-up-1');
    expect(res.headers.get('x-capy-provider')).toBe('openai');
    expect(res.headers.get('x-capy-latency-ms')).toBeDefined();
    expect(capturedBody.stream_options).toBeDefined();
    expect(capturedBody.stream_options.include_usage).toBe(true);

    const sseResponse = await res.text();
    expect(sseResponse).toContain('Capy');
    expect(sseResponse).toContain('bara');
    expect(sseResponse).toContain('[DONE]');
  });

  it('enforces allowed_models on virtual keys and blocks unauthorized models', async () => {
    const vkRestricted = generateVirtualKey();
    const now = Date.now();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm, budget_monthly_usd,
        current_spend_usd, spend_reset_at, allowed_pools, allowed_models,
        is_active, created_at, updated_at
      ) VALUES ('vk-mini-only', 'Mini Only', ?, ?, 0, 100, 0, ?, NULL, '["gpt-4o-mini"]', 1, ?, ?)
    `).run(vkRestricted.keyHash, vkRestricted.keyPrefix, now, now, now);

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vkRestricted.fullKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'o1',
        messages: [{ role: 'user', content: 'Test forbidden' }],
      }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.message).toContain('not allowed');
    expect(json.error.type).toBe('permission_error');
  });

  it('accepts lowercase bearer in authorization header', async () => {
    const res = await app.request('/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `bearer ${virtualKey}`,
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe('list');
    expect(json.data.length).toBeGreaterThan(0);
  });

  it('supports GET /v1/models/:model endpoint', async () => {
    const res = await app.request('/v1/models/gpt-4o', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('gpt-4o');
    expect(json.object).toBe('model');
    expect(json.owned_by).toBe('capyllm');
  });

  it('handles upstream 400 error cleanly on streaming request without event-stream coercion', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        error: {
          message: 'Invalid model parameter',
          type: 'invalid_request_error',
        },
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'unknown-model',
        messages: [],
        stream: true,
      }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const json = await res.json();
    expect(json.error.message).toBe('Invalid model parameter');
    expect(json.capy_meta).toBeDefined();
  });

  it('captures TTFT on reasoning_content deltas for reasoning models', async () => {
    globalThis.fetch = (async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"reasoning_content":"Thinking about problem..."}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Here is the solution."}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
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
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        messages: [{ role: 'user', content: 'Solve riddle' }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    await res.text();

    await new Promise((r) => setTimeout(r, 60));
    const log = db.query('SELECT ttft_ms FROM request_logs WHERE model = "deepseek-reasoner"').get() as any;
    expect(log).toBeDefined();
    expect(log.ttft_ms).toBeGreaterThanOrEqual(0);
  });

  it('relays /v1/embeddings requests and injects metadata', async () => {
    globalThis.fetch = (async (url: any, init: any) => {
      expect(url.toString()).toBe('https://mock.api.com/v1/embeddings');

      return new Response(JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 8, total_tokens: 8 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await app.request('/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'Test embeddings vector',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].embedding.length).toBe(3);
    expect(json.capy_meta).toBeDefined();
    expect(json.capy_meta.provider).toBe('openai');
  });

  it('relays Jev decision requests to /v1/systemone and /v1/decisions', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: any) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({
        decision_id: 'dec-12345',
        verdict: 'approved',
        confidence: 0.98,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const resSystemOne = await app.request('/v1/systemone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'Approve transaction?', amount: 150 }),
    });

    expect(resSystemOne.status).toBe(200);
    expect(capturedUrl).toContain('/systemone');
    const json1 = await resSystemOne.json();
    expect(json1.verdict).toBe('approved');
    expect(json1.capy_meta).toBeDefined();

    const resDecisions = await app.request('/v1/decisions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'assess_risk' }),
    });

    expect(resDecisions.status).toBe(200);
    expect(capturedUrl).toContain('/decisions');
    const json2 = await resDecisions.json();
    expect(json2.verdict).toBe('approved');
  });
});
