import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { app } from '../src/index';
import { initDatabase } from '../src/db';
import { encryptSecret, generateVirtualKey } from '../src/crypto';
import {
  clearRoundRobinCounters,
  stripProviderPrefix,
  resolveModelForUpstream,
  matchModelPattern,
} from '../src/engine/pool';
import {
  getModelCapabilities,
  adaptPayloadForTargetModel,
} from '../src/engine/model_capabilities';

describe('Model Normalization and Dynamic Reasoning Policies', () => {
  let db: any;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    db = initDatabase(':memory:');
    clearRoundRobinCounters();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Zero-Config Model Name Resolution (stripProviderPrefix & resolveModelForUpstream)', () => {
    it('strips provider prefixes correctly', () => {
      expect(stripProviderPrefix('openai/gpt-4o')).toBe('gpt-4o');
      expect(stripProviderPrefix('anthropic/claude-3-7-sonnet')).toBe('claude-3-7-sonnet');
      expect(stripProviderPrefix('google/gemini-2.5-flash')).toBe('gemini-2.5-flash');
      expect(stripProviderPrefix('gpt-4o')).toBe('gpt-4o');
      expect(stripProviderPrefix('')).toBe('');
    });

    it('resolves direct models for OpenAI native upstream by removing vendor prefix', () => {
      expect(resolveModelForUpstream('openai/gpt-4o', 'openai')).toBe('gpt-4o');
      expect(resolveModelForUpstream('gpt-4o', 'openai')).toBe('gpt-4o');
      expect(resolveModelForUpstream('openai/o3-mini', 'openai')).toBe('o3-mini');
    });

    it('resolves direct models for Anthropic, Gemini, Mistral, and DeepSeek', () => {
      expect(resolveModelForUpstream('anthropic/claude-3-5-sonnet', 'anthropic')).toBe('claude-3-5-sonnet');
      expect(resolveModelForUpstream('google/gemini-2.5-flash', 'gemini')).toBe('gemini-2.5-flash');
      expect(resolveModelForUpstream('deepseek/deepseek-chat', 'deepseek')).toBe('deepseek-chat');
      expect(resolveModelForUpstream('mistralai/mistral-large', 'mistral')).toBe('mistral-large');
    });

    it('resolves namespaced model for OpenRouter from plain requested name', () => {
      // Without discovered models, uses snapshot / known heuristics
      expect(resolveModelForUpstream('gpt-4o', 'openrouter')).toBe('openai/gpt-4o');
      expect(resolveModelForUpstream('claude-3-5-sonnet', 'openrouter')).toBe('anthropic/claude-3-5-sonnet');
      expect(resolveModelForUpstream('openai/gpt-4o', 'openrouter')).toBe('openai/gpt-4o');

      // With explicit discovered models list
      const discovered = JSON.stringify(['openai/gpt-4o', 'meta-llama/llama-3.3-70b-instruct']);
      expect(resolveModelForUpstream('gpt-4o', 'openrouter', discovered)).toBe('openai/gpt-4o');
      expect(resolveModelForUpstream('llama-3.3-70b-instruct', 'openrouter', discovered)).toBe('meta-llama/llama-3.3-70b-instruct');
    });

    it('matches canonical model in matchModelPattern across formats', () => {
      expect(matchModelPattern('gpt-4o', 'openai/gpt-4o')).toBe(true);
      expect(matchModelPattern('openai/gpt-4o', 'gpt-4o')).toBe(true);
      expect(matchModelPattern('gpt-4o', 'gpt-4o')).toBe(true);
      expect(matchModelPattern('openai/gpt-4o', 'openai/gpt-4o')).toBe(true);

      // Does not match different model
      expect(matchModelPattern('gpt-4o', 'gpt-4o-mini')).toBe(false);
      expect(matchModelPattern('openai/gpt-4o', 'openai/gpt-4o-mini')).toBe(false);

      // Wildcard with prefix
      expect(matchModelPattern('*-mini', 'openai/gpt-4o-mini')).toBe(true);
      expect(matchModelPattern('*-mini', 'gpt-4o-mini')).toBe(true);
      expect(matchModelPattern('openai/*', 'gpt-4o')).toBe(true);
      expect(matchModelPattern('openai/*', 'openai/gpt-4o')).toBe(true);
    });
  });

  describe('2. Reasoning Dialect Translation via models.dev (model_capabilities.ts)', () => {
    it('detects model capabilities and reasoning options from models.dev snapshot', () => {
      const terraCaps = getModelCapabilities('openai', 'gpt-6.1-terra');
      expect(terraCaps.reasoning).toBe(true);
      expect(terraCaps.temperature).toBe(false); // rejects temperature
      expect(terraCaps.reasoningEffortValues).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

      const sonnetCaps = getModelCapabilities('anthropic', 'claude-sonnet-5-5');
      expect(sonnetCaps.reasoning).toBe(true);
      expect(sonnetCaps.temperature).toBe(false);
      expect(sonnetCaps.reasoningEffortValues).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);

      const gpt4oCaps = getModelCapabilities('openai', 'gpt-4o');
      expect(gpt4oCaps.reasoning).toBe(false);
      expect(gpt4oCaps.temperature).toBe(true);
    });

    it('translates Anthropic thinking/budget_tokens into OpenAI reasoning_effort', () => {
      const payload = {
        model: 'claude-3-7-sonnet',
        messages: [{ role: 'user', content: 'solve logic problem' }],
        thinking: { type: 'enabled', budget_tokens: 8192 },
      };

      const adapted = adaptPayloadForTargetModel(payload, 'o3-mini', 'openai', 'inherit');
      expect(adapted.model).toBe('o3-mini');
      expect(adapted.thinking).toBeUndefined();
      expect(adapted.budget_tokens).toBeUndefined();
      expect(adapted.reasoning_effort).toBe('medium');
    });

    it('translates OpenAI reasoning_effort into Anthropic thinking: { type: "enabled", budget_tokens }', () => {
      const payload = {
        model: 'o1',
        messages: [{ role: 'user', content: 'code a complex function' }],
        reasoning_effort: 'high',
      };

      const adapted = adaptPayloadForTargetModel(payload, 'claude-haiku-4-5', 'anthropic', 'inherit');
      expect(adapted.model).toBe('claude-haiku-4-5');
      expect(adapted.reasoning_effort).toBeUndefined();
      expect(adapted.thinking).toBeDefined();
      expect(adapted.thinking.type).toBe('enabled');
      expect(adapted.thinking.budget_tokens).toBe(32000);
      expect(adapted.budget_tokens).toBe(32000);
    });

    it('dynamically adapts newer Anthropic models that use effort according to models.dev metadata', () => {
      // claude-opus-4-7 in models.dev uses effort: ["low", "medium", "high", "xhigh", "max"]
      const payload = {
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'solve complex math' }],
        thinking: { type: 'enabled', budget_tokens: 32000 },
      };

      const adapted = adaptPayloadForTargetModel(payload, 'claude-opus-4-7', 'anthropic', 'high');
      expect(adapted.model).toBe('claude-opus-4-7');
      expect(adapted.reasoning_effort).toBe('high');
      expect(adapted.thinking).toBeUndefined();
      expect(adapted.budget_tokens).toBeUndefined();

      // Test max effort
      const adaptedMax = adaptPayloadForTargetModel(payload, 'claude-opus-4-7', 'anthropic', 'max');
      expect(adaptedMax.reasoning_effort).toBe('max');
    });

    it('removes reasoning parameters when falling back to a standard non-reasoning model', () => {
      const payload = {
        model: 'o1',
        messages: [{ role: 'user', content: 'hello' }],
        reasoning_effort: 'high',
        thinking: { type: 'enabled', budget_tokens: 16000 },
        budget_tokens: 16000,
      };

      const adapted = adaptPayloadForTargetModel(payload, 'gpt-4o', 'openai', 'inherit');
      expect(adapted.model).toBe('gpt-4o');
      expect(adapted.reasoning_effort).toBeUndefined();
      expect(adapted.thinking).toBeUndefined();
      expect(adapted.budget_tokens).toBeUndefined();
    });

    it('strips temperature, top_p, presence_penalty, frequency_penalty and logprobs for modern models with temperature: false', () => {
      const payload = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        top_p: 0.95,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
        logprobs: true,
        reasoning_effort: 'medium',
      };

      const adapted = adaptPayloadForTargetModel(payload, 'gpt-6.1-terra', 'openai', 'inherit');
      expect(adapted.model).toBe('gpt-6.1-terra');
      expect(adapted.temperature).toBeUndefined();
      expect(adapted.top_p).toBeUndefined();
      expect(adapted.presence_penalty).toBeUndefined();
      expect(adapted.frequency_penalty).toBeUndefined();
      expect(adapted.logprobs).toBeUndefined();
      expect(adapted.reasoning_effort).toBe('medium');
    });

    it('preserves Responses API parameters like previous_response_id, service_tier, store and input', () => {
      const payload = {
        model: 'gpt-6-astra',
        service_tier: 'ultrafast',
        store: false,
        previous_response_id: 'resp_previous_123',
        input: 'Explain why sunsets look red.',
        temperature: 0.7, // should be cleaned because gpt-6-astra has temperature: false
      };

      const adapted = adaptPayloadForTargetModel(payload, 'gpt-6-astra', 'openai', 'inherit');
      expect(adapted.model).toBe('gpt-6-astra');
      expect(adapted.service_tier).toBe('ultrafast');
      expect(adapted.store).toBe(false);
      expect(adapted.previous_response_id).toBe('resp_previous_123');
      expect(adapted.input).toBe('Explain why sunsets look red.');
      expect(adapted.reasoning_effort).toBeUndefined();
      expect(adapted.temperature).toBeUndefined();
    });

    it('preserves sampling parameters when fallback model supports them (e.g. Qwen on OpenRouter)', () => {
      const clientReq = {
        model: 'gpt-6-astra',
        messages: [{ role: 'user', content: 'solve this math problem' }],
        temperature: 0.7,
        top_p: 0.9,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
        logprobs: true,
        reasoning_effort: 'high',
      };

      // 1. Primary: gpt-6-astra (OpenAI, temperature: false) -> sampling stripped, effort kept
      const forAstra = adaptPayloadForTargetModel(clientReq, 'gpt-6-astra', 'openai', 'inherit');
      expect(forAstra.temperature).toBeUndefined();
      expect(forAstra.top_p).toBeUndefined();
      expect(forAstra.presence_penalty).toBeUndefined();
      expect(forAstra.frequency_penalty).toBeUndefined();
      expect(forAstra.logprobs).toBeUndefined();
      expect(forAstra.reasoning_effort).toBe('high');

      // 2. Fallback: Qwen standard on OpenRouter (temperature: true, reasoning: false) -> sampling kept, effort stripped
      const forQwenStd = adaptPayloadForTargetModel(clientReq, 'qwen/qwen-2.5-72b-instruct', 'openrouter', 'inherit');
      expect(forQwenStd.temperature).toBe(0.7);
      expect(forQwenStd.top_p).toBe(0.9);
      expect(forQwenStd.presence_penalty).toBe(0.5);
      expect(forQwenStd.frequency_penalty).toBe(0.3);
      expect(forQwenStd.logprobs).toBe(true);
      expect(forQwenStd.reasoning_effort).toBeUndefined();

      // 3. Fallback: Qwen reasoning on OpenRouter (temperature: true, reasoning: true) -> both sampling and effort kept!
      const forQwenReasoning = adaptPayloadForTargetModel(clientReq, 'qwen/qwen3.8-max-0902', 'openrouter', 'inherit');
      expect(forQwenReasoning.temperature).toBe(0.7);
      expect(forQwenReasoning.top_p).toBe(0.9);
      expect(forQwenReasoning.presence_penalty).toBe(0.5);
      expect(forQwenReasoning.frequency_penalty).toBe(0.3);
      expect(forQwenReasoning.logprobs).toBe(true);
      expect(forQwenReasoning.reasoning_effort).toBe('high');
    });

    it('preserves max_tokens cleanly without fragile parameter mutation', () => {
      const payload = {
        model: 'gpt-5.6-terra',
        messages: [{ role: 'user', content: 'test tokens' }],
        max_tokens: 150,
      };

      const traceCollector: { trace?: any } = {};
      const adapted = adaptPayloadForTargetModel(payload, 'gpt-5.6-terra', 'openai', 'inherit', traceCollector);
      expect(adapted.max_tokens).toBe(150);
      expect(adapted.max_completion_tokens).toBeUndefined();
    });

    it('defaults uncataloged future models dynamically to modern frontier reality without model name regexes', () => {
      const payload = {
        model: 'future-quantum-preview-2027',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        top_p: 0.9,
      };

      const adapted = adaptPayloadForTargetModel(payload, 'future-quantum-preview-2027', 'openai', 'inherit');
      expect(adapted.model).toBe('future-quantum-preview-2027');
      expect(adapted.temperature).toBeUndefined();
      expect(adapted.top_p).toBeUndefined();
      expect(adapted.reasoning_effort).toBeUndefined();
    });
  });

  describe('3. Dynamic Pool & Route Reasoning Policies', () => {
    it('enforces policy = "low" on effort models', () => {
      const payload = {
        model: 'gpt-6-astra',
        messages: [{ role: 'user', content: 'quick answer' }],
      };

      const adapted = adaptPayloadForTargetModel(payload, 'gpt-6-astra', 'openai', 'low');
      expect(adapted.reasoning_effort).toBe('low');
    });

    it('enforces policy = "high" on budget_tokens models (32,000 tokens clamped)', () => {
      const payload = {
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'deep analysis' }],
      };

      const adapted = adaptPayloadForTargetModel(payload, 'claude-haiku-4-5', 'anthropic', 'high');
      expect(adapted.thinking.type).toBe('enabled');
      expect(adapted.thinking.budget_tokens).toBe(32000);
      expect(adapted.budget_tokens).toBe(32000);
    });

    it('enforces policy = "none" / "fast" dynamically: sets "none" if supported, minimal allowed if required, strips if unsupported', () => {
      // 1. Model that supports explicit "none" effort (e.g. gpt-6.1-terra)
      const payloadTerra = {
        model: 'gpt-6.1-terra',
        messages: [{ role: 'user', content: 'fast summary' }],
        reasoning_effort: 'high',
      };
      const adaptedTerra = adaptPayloadForTargetModel(payloadTerra, 'gpt-6.1-terra', 'openai', 'none');
      expect(adaptedTerra.reasoning_effort).toBe('none');

      // 2. Modern reasoning-only model where reasoning cannot be disabled (e.g. claude-sonnet-5-5, gpt-6-astra)
      const payloadSonnet = {
        model: 'claude-sonnet-5-5',
        messages: [{ role: 'user', content: 'fast summary' }],
        reasoning_effort: 'high',
      };
      const adaptedSonnet = adaptPayloadForTargetModel(payloadSonnet, 'claude-sonnet-5-5', 'anthropic', 'none');
      expect(adaptedSonnet.reasoning_effort).toBe('low'); // Minimum allowed reasoning by models.dev

      // 3. Genuine non-reasoning legacy model (e.g. gpt-4o)
      const payloadGpt4o = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'fast summary' }],
        reasoning_effort: 'high',
      };
      const adaptedGpt4o = adaptPayloadForTargetModel(payloadGpt4o, 'gpt-4o', 'openai', 'none');
      expect(adaptedGpt4o.reasoning_effort).toBeUndefined();
    });
  });

  describe('4. End-to-End Relay Routing & CapyKey Permissions', () => {
    it('allows CapyKey with allowed_models = ["gpt-4o"] to request "openai/gpt-4o" transparently', async () => {
      const now = Date.now();
      const encKey = encryptSecret('sk-openai-direct');
      db.query(`
        INSERT INTO upstream_keys (id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
        VALUES ('k-dir-1', 'openai', 'OpenAI Direct', 'https://mock.openai.com/v1', ?, 1, ?, ?)
      `).run(encKey, now, now);

      db.query(`
        INSERT INTO pools (id, name, created_at, updated_at)
        VALUES ('pool-p1', 'Pool 1', ?, ?)
      `).run(now, now);

      db.query(`
        INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
        VALUES ('r-p1', 'pool-p1', 'k-dir-1', 0, 'gpt-4o', ?)
      `).run(now);

      const gen = generateVirtualKey();
      db.query(`
        INSERT INTO virtual_keys (
          id, name, key_hash, key_prefix, pool_id, is_active, allowed_models, created_at, updated_at
        ) VALUES ('vk-p1', 'Client App', ?, ?, 'pool-p1', 1, '["gpt-4o"]', ?, ?)
      `).run(gen.keyHash, gen.keyPrefix, now, now);

      let dispatchedModel = '';
      globalThis.fetch = (async (url: any, init: any) => {
        const body = JSON.parse(init.body);
        dispatchedModel = body.model;
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'Success' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      // Client requests 'openai/gpt-4o'
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gen.fullKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      expect(res.status).toBe(200);
      // Upstream OpenAI received direct 'gpt-4o' without vendor prefix!
      expect(dispatchedModel).toBe('gpt-4o');
    });

    it('automatically prefixes model when dispatching towards OpenRouter', async () => {
      const now = Date.now();
      const encKey = encryptSecret('sk-openrouter-key');
      db.query(`
        INSERT INTO upstream_keys (
          id, provider, name, base_url, encrypted_key, is_active, discovered_models, created_at, updated_at
        ) VALUES ('k-or-1', 'openrouter', 'OpenRouter Hub', 'https://mock.openrouter.ai/v1', ?, 1, '["openai/gpt-4o"]', ?, ?)
      `).run(encKey, now, now);

      db.query(`
        INSERT INTO pools (id, name, created_at, updated_at)
        VALUES ('pool-or', 'OpenRouter Pool', ?, ?)
      `).run(now, now);

      db.query(`
        INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
        VALUES ('r-or', 'pool-or', 'k-or-1', 0, '*', ?)
      `).run(now);

      const gen = generateVirtualKey();
      db.query(`
        INSERT INTO virtual_keys (
          id, name, key_hash, key_prefix, pool_id, is_active, created_at, updated_at
        ) VALUES ('vk-or', 'OR Client', ?, ?, 'pool-or', 1, ?, ?)
      `).run(gen.keyHash, gen.keyPrefix, now, now);

      let dispatchedModel = '';
      globalThis.fetch = (async (url: any, init: any) => {
        const body = JSON.parse(init.body);
        dispatchedModel = body.model;
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'From OpenRouter' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      // Client requests plain 'gpt-4o'
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gen.fullKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      expect(res.status).toBe(200);
      // Upstream OpenRouter received prefixed 'openai/gpt-4o'!
      expect(dispatchedModel).toBe('openai/gpt-4o');
    });

    it('applies pool reasoning_policy = "high" to calls within that pool', async () => {
      const now = Date.now();
      const encKey = encryptSecret('sk-openai-key');
      db.query(`
        INSERT INTO upstream_keys (id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
        VALUES ('k-o3', 'openai', 'OpenAI Main', 'https://mock.openai.com/v1', ?, 1, ?, ?)
      `).run(encKey, now, now);

      // Pool with reasoning_policy = 'high'
      db.query(`
        INSERT INTO pools (id, name, reasoning_policy, created_at, updated_at)
        VALUES ('pool-deep', 'Deep Reasoning Pool', 'high', ?, ?)
      `).run(now, now);

      db.query(`
        INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
        VALUES ('r-deep', 'pool-deep', 'k-o3', 0, '*', ?)
      `).run(now);

      const gen = generateVirtualKey();
      db.query(`
        INSERT INTO virtual_keys (
          id, name, key_hash, key_prefix, pool_id, is_active, created_at, updated_at
        ) VALUES ('vk-deep', 'Deep Key', ?, ?, 'pool-deep', 1, ?, ?)
      `).run(gen.keyHash, gen.keyPrefix, now, now);

      let dispatchedEffort = '';
      globalThis.fetch = (async (url: any, init: any) => {
        const body = JSON.parse(init.body);
        dispatchedEffort = body.reasoning_effort;
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'Deep thought result' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      // Client does not specify reasoning_effort
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gen.fullKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'o3-mini',
          messages: [{ role: 'user', content: 'Hard problem' }],
        }),
      });

      expect(res.status).toBe(200);
      expect(dispatchedEffort).toBe('high');
    });

    it('route reasoning_effort overrides pool reasoning_policy', async () => {
      const now = Date.now();
      const encKey = encryptSecret('sk-openai-key');
      db.query(`
        INSERT INTO upstream_keys (id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
        VALUES ('k-route-override', 'openai', 'OpenAI Main', 'https://mock.openai.com/v1', ?, 1, ?, ?)
      `).run(encKey, now, now);

      // Pool policy is 'high', but Route overrides to 'low'
      db.query(`
        INSERT INTO pools (id, name, reasoning_policy, created_at, updated_at)
        VALUES ('pool-override', 'High Pool', 'high', ?, ?)
      `).run(now, now);

      db.query(`
        INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, reasoning_effort, created_at)
        VALUES ('r-override', 'pool-override', 'k-route-override', 0, '*', 'low', ?)
      `).run(now);

      const gen = generateVirtualKey();
      db.query(`
        INSERT INTO virtual_keys (
          id, name, key_hash, key_prefix, pool_id, is_active, created_at, updated_at
        ) VALUES ('vk-override', 'Override Key', ?, ?, 'pool-override', 1, ?, ?)
      `).run(gen.keyHash, gen.keyPrefix, now, now);

      let dispatchedEffort = '';
      globalThis.fetch = (async (url: any, init: any) => {
        const body = JSON.parse(init.body);
        dispatchedEffort = body.reasoning_effort;
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'Light thought result' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gen.fullKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'o3-mini',
          messages: [{ role: 'user', content: 'Quick answer' }],
        }),
      });

      expect(res.status).toBe(200);
      expect(dispatchedEffort).toBe('low');
    });
  });

  describe('5. Admin CRUD for Reasoning Policy & Routes', () => {
    it('creates and updates pools with reasoning_policy', async () => {
      const now = Date.now();
      const { createTestSessionCookie } = await import('../src/auth/session');
      const adminCookie = await createTestSessionCookie({
        userId: 'admin-test',
        email: 'admin@capyllm.ai',
        role: 'admin',
        createdAt: now,
      });

      // 1. Create pool with reasoning_policy = 'medium'
      const createRes = await app.request('/api/admin/pools', {
        method: 'POST',
        headers: {
          'Cookie': adminCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'pool-reasoning-test',
          name: 'Reasoning Test Pool',
          budget_type: 'tokens',
          budget_cadence: 'daily',
          budget_limit: 100000,
          reasoning_policy: 'medium',
        }),
      });
      expect(createRes.status).toBe(201);

      // Verify in DB
      const poolDb: any = db.query('SELECT * FROM pools WHERE id = ?').get('pool-reasoning-test');
      expect(poolDb.reasoning_policy).toBe('medium');

      // 2. Update pool reasoning_policy to 'high'
      const patchRes = await app.request('/api/admin/pools/pool-reasoning-test', {
        method: 'PATCH',
        headers: {
          'Cookie': adminCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reasoning_policy: 'high',
        }),
      });
      expect(patchRes.status).toBe(200);

      const updatedPool: any = db.query('SELECT * FROM pools WHERE id = ?').get('pool-reasoning-test');
      expect(updatedPool.reasoning_policy).toBe('high');

      // 3. Configure routes with reasoning_effort
      const encKey = encryptSecret('sk-test');
      db.query(`
        INSERT INTO upstream_keys (id, provider, name, base_url, encrypted_key, is_active, created_at, updated_at)
        VALUES ('k-test-crud', 'openai', 'Test Key', 'https://api.openai.com/v1', ?, 1, ?, ?)
      `).run(encKey, now, now);

      const routesRes = await app.request('/api/admin/pools/pool-reasoning-test/routes', {
        method: 'POST',
        headers: {
          'Cookie': adminCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          routes: [
            {
              upstream_key_id: 'k-test-crud',
              priority: 0,
              model_pattern: 'o3-mini',
              reasoning_effort: 'low',
            },
          ],
        }),
      });
      expect(routesRes.status).toBe(200);

      // 4. GET /api/admin/pools returns reasoning_policy and route reasoning_effort
      const getRes = await app.request('/api/admin/pools', {
        headers: {
          'Cookie': adminCookie,
        },
      });
      expect(getRes.status).toBe(200);
      const getJson: any = await getRes.json();
      const p = getJson.pools.find((item: any) => item.id === 'pool-reasoning-test');
      expect(p).toBeDefined();
      expect(p.reasoning_policy).toBe('high');
      expect(p.routes[0].reasoning_effort).toBe('low');
    });
  });

  describe('6. Dynamic Adaptation Trace, Token Extraction & Audit Logs', () => {
    it('populates AdaptationTrace with transformations, stripped parameters, and reasoning explanations', () => {
      const traceCollector: { trace?: any } = {};
      const payload = {
        model: 'gpt-5.6-terra',
        temperature: 0.8,
        top_p: 0.95,
        presence_penalty: 0.5,
        reasoning_effort: 'max',
        messages: [{ role: 'user', content: 'Hello world' }],
      };

      const adapted = adaptPayloadForTargetModel(payload, 'gpt-5.6-terra', 'openai', 'low', traceCollector);

      expect(adapted.temperature).toBeUndefined();
      expect(adapted.top_p).toBeUndefined();
      expect(adapted.presence_penalty).toBeUndefined();
      expect(adapted.reasoning_effort).toBe('low');

      expect(traceCollector.trace).toBeDefined();
      const t = traceCollector.trace!;
      expect(t.target_model).toBe('gpt-5.6-terra');
      expect(t.effective_policy).toBe('low');
      expect(t.temperature_supported).toBe(false);
      expect(t.reasoning_supported).toBe(true);
      expect(t.stripped_parameters.length).toBeGreaterThan(0);
      expect(t.stripped_parameters.some((p: string) => p.includes('temperature'))).toBe(true);
      expect(t.stripped_parameters.some((p: string) => p.includes('top_p'))).toBe(true);
      expect(t.transformations.length).toBeGreaterThan(0);
      expect(t.original_params.temperature).toBe(0.8);
      expect(t.adapted_params.temperature).toBeUndefined();
      expect(t.adapted_params.reasoning_effort).toBe('low');
    });

    it('records adaptation_meta and ensures non-zero tokens in request_logs and GET /api/admin/logs', async () => {
      const now = Date.now();
      const encKey = encryptSecret('sk-audit-test');

      db.query(`
        INSERT INTO pools (id, name, reasoning_policy, created_at, updated_at)
        VALUES ('pool-audit-test', 'Audit Pool', 'medium', ?, ?)
      `).run(now, now);

      db.query(`
        INSERT INTO upstream_keys (id, provider, name, base_url, encrypted_key, pool_id, is_active, is_free_tier, created_at, updated_at)
        VALUES ('k-audit-test', 'openai', 'Audit Upstream', 'https://api.openai.com/v1', ?, 'pool-audit-test', 1, 1, ?, ?)
      `).run(encKey, now, now);

      db.query(`
        INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, reasoning_effort, created_at)
        VALUES ('r-audit-test', 'pool-audit-test', 'k-audit-test', 0, '*', 'low', ?)
      `).run(now);

      const vk = generateVirtualKey();
      db.query(`
        INSERT INTO virtual_keys (id, name, key_hash, key_prefix, pool_id, is_active, created_at, updated_at)
        VALUES ('vk-audit-test', 'Audit App', ?, ?, 'pool-audit-test', 1, ?, ?)
      `).run(vk.keyHash, vk.keyPrefix, now, now);

      // Mock upstream returning 200 without usage object (testing fallback token calculation)
      globalThis.fetch = (async (input: any) => {
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          model: 'gpt-5.6-terra',
          choices: [{ message: { role: 'assistant', content: 'The sky is blue due to Rayleigh scattering.' } }],
          // note: no usage object here on purpose!
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${vk.fullKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5.6-terra',
          temperature: 0.7,
          messages: [{ role: 'user', content: 'Why is the sky blue?' }],
        }),
      });

      expect(res.status).toBe(200);
      const resJson: any = await res.json();
      expect(resJson.capy_meta).toBeDefined();
      expect(resJson.capy_meta.adaptation).toBeDefined();
      expect(resJson.capy_meta.adaptation.target_model).toBe('gpt-5.6-terra');

      // Allow background microtask queue to write to request_logs
      await new Promise((r) => setTimeout(r, 50));

      const logRow = db.query(`SELECT * FROM request_logs WHERE virtual_key_id = 'vk-audit-test'`).get() as any;
      expect(logRow).toBeDefined();
      expect(logRow.total_tokens).toBeGreaterThan(0);
      expect(logRow.prompt_tokens).toBeGreaterThan(0);
      expect(logRow.completion_tokens).toBeGreaterThan(0);
      expect(logRow.adaptation_meta).toBeDefined();

      const parsedMeta = JSON.parse(logRow.adaptation_meta);
      expect(parsedMeta.target_model).toBe('gpt-5.6-terra');
      expect(parsedMeta.transformations.length).toBeGreaterThan(0);

      // Test admin logs endpoint
      db.query(`INSERT INTO users (id, email, role, created_at) VALUES ('u-admin-audit', 'audit-admin@test.com', 'admin', ?)`).run(now);
      const { createTestSessionCookie } = await import('../src/auth/session');
      const adminCookie = await createTestSessionCookie({
        userId: 'u-admin-audit',
        email: 'audit-admin@test.com',
        role: 'admin',
        createdAt: now,
      });

      const adminLogsRes = await app.request('/api/admin/logs', {
        headers: { 'Cookie': adminCookie },
      });
      expect(adminLogsRes.status).toBe(200);
      const adminLogsJson: any = await adminLogsRes.json();
      const targetLog = adminLogsJson.logs.find((l: any) => l.id === logRow.id);
      expect(targetLog).toBeDefined();
      expect(targetLog.pool_name).toBe('Audit Pool');
      expect(targetLog.upstream_is_free_tier).toBe(1);
      expect(targetLog.tokens_total).toBeGreaterThan(0);
      expect(targetLog.tokens_prompt).toBeGreaterThan(0);
      expect(targetLog.tokens_completion).toBeGreaterThan(0);
      expect(targetLog.adaptation_meta).toBeDefined();
    });
  });
});
