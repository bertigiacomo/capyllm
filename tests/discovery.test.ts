import { describe, it, expect, beforeEach } from 'bun:test';
import { discoverModelsForProvider, PROVIDER_PRESETS } from '../src/engine/discovery';
import { initDatabase, getDatabase, closeDatabase } from '../src/db';
import { app } from '../src/index';

describe('Zero-Token Model Discovery & Presets', () => {
  beforeEach(() => {
    closeDatabase();
    process.env.CAPY_DB_PATH = ':memory:';
    process.env.CAPY_MASTER_KEY = 'test-master-key-32-chars-length!!';
    initDatabase(':memory:');
  });

  it('provides all standard provider presets', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(8);
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('gemini');
    expect(ids).toContain('groq');
    expect(ids).toContain('mistral');
    expect(ids).toContain('deepseek');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('together');
    expect(ids).toContain('ollama');
    expect(ids).toContain('jev');
  });

  it('discovers models for Jev/Kev decision provider without network call', async () => {
    const res = await discoverModelsForProvider('jev', 'https://api.typesafe.ai/v1', 'mock-key');
    expect(res.success).toBe(true);
    expect(res.models).toContain('systemone');
    expect(res.models).toContain('decisions');
    expect(res.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('handles mock OpenAI models endpoint (0 tokens)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, opts: any) => {
      expect(String(url)).toContain('/models');
      expect(opts.headers.Authorization).toBe('Bearer sk-test-key');
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gpt-4o', object: 'model' },
            { id: 'gpt-4o-mini', object: 'model' },
            { id: 'o3-mini', object: 'model' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const res = await discoverModelsForProvider('openai', 'https://api.openai.com/v1', 'sk-test-key');
      expect(res.success).toBe(true);
      expect(res.models).toEqual(['gpt-4o', 'gpt-4o-mini', 'o3-mini']);
      expect(res.latency_ms).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles mock Google Gemini native models endpoint (0 tokens)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
      return new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
            { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
            { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const res = await discoverModelsForProvider(
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai/',
        'AIzaSyTestKey'
      );
      expect(res.success).toBe(true);
      expect(res.models).toEqual(['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aggregates discovered models across upstream keys in GET /v1/models', async () => {
    const db = getDatabase();
    const now = Date.now();
    // Insert upstream key with discovered models
    db.query(`
      INSERT INTO upstream_keys (
        id, pool_id, provider, name, base_url, encrypted_key, is_active, cooldown_until, fail_count, last_error, discovered_models, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, NULL, ?, ?, ?)
    `).run(
      'key-1',
      'default',
      'openai',
      'OpenAI Key',
      'https://api.openai.com/v1',
      'mock_enc',
      JSON.stringify(['gpt-4o-custom', 'o3-preview']),
      now,
      now
    );

    // Insert virtual key (CapyKey)
    const { generateVirtualKey } = await import('../src/crypto');
    const vk = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm, budget_monthly_usd, current_spend_usd, spend_reset_at, allowed_pools, allowed_models, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, NULL, NULL, 1, ?, ?)
    `).run('vk-1', 'Test CapyKey', vk.keyHash, vk.keyPrefix, now, now, now);

    const res = await app.request('/v1/models', {
      headers: {
        Authorization: `Bearer ${vk.fullKey}`,
      },
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    const ids = body.data.map((m: any) => m.id);
    expect(ids).toContain('gpt-4o-custom');
    expect(ids).toContain('o3-preview');
  });
});
