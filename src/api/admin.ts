import { Hono } from 'hono';
import crypto from 'node:crypto';
import { requireAdmin } from '../auth/middleware';
import {
  getDatabase,
  calculateNextResetAt,
  getDailyResetHour,
  setSystemSetting,
  getSystemSetting,
  type UpstreamKey,
  type Pool,
  type VirtualKey,
  type RequestLog,
  type ModelPricing,
} from '../db';
import { encryptSecret, decryptSecret, generateVirtualKey, maskKey, sanitizeErrorMessage } from '../crypto';
import { resetKeyCooldown, resetPoolCounter, stripProviderPrefix } from '../engine/pool';
import { clearPricingCache } from '../engine/pricing';
import { getTelegramConfig, saveTelegramSettings, testTelegramWebhook } from '../engine/telegram';
import { discoverModelsForProvider, PROVIDER_PRESETS, getAllModelsDevProviders } from '../engine/discovery';
import { getModelsDevCatalog, getEnrichedModelMetadata, getProviderLogoUrl } from '../services/models_dev';
import {
  CreateUpstreamKeySchema,
  UpdateUpstreamKeySchema,
  CreatePoolSchema,
  UpdatePoolSchema,
  SetPoolRoutesSchema,
  CreateVirtualKeySchema,
  UpdateVirtualKeySchema,
  CreatePricingRuleSchema,
  UpdatePricingRuleSchema,
  SaveTelegramSettingsSchema,
  TestTelegramSchema,
  UpdateSystemSettingsSchema,
} from '../schema';

export const adminRouter = new Hono();

// Require admin for all /api/admin routes
adminRouter.use('*', requireAdmin);

function normalizeArrayParam(val: any): string | null {
  if (val === undefined || val === null || val === '') return null;
  if (Array.isArray(val)) {
    const filtered = val.map((s) => String(s).trim()).filter(Boolean);
    return filtered.length > 0 ? JSON.stringify(filtered) : null;
  }
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        const filtered = parsed.map((s) => String(s).trim()).filter(Boolean);
        return filtered.length > 0 ? JSON.stringify(filtered) : null;
      }
    } catch {}
    const split = val.split(',').map((s) => s.trim()).filter(Boolean);
    return split.length > 0 ? JSON.stringify(split) : null;
  }
  return null;
}

// ==========================================
// 1. UPSTREAM KEYS & DISCOVERY
// ==========================================

// GET /api/admin/provider-presets
adminRouter.get('/provider-presets', (c) => {
  return c.json({
    presets: PROVIDER_PRESETS,
    all_providers: getAllModelsDevProviders(),
  });
});

// GET /api/admin/discovered-models
// Aggregates all unique discovered models across active upstream keys
adminRouter.get('/discovered-models', (c) => {
  const db = getDatabase();
  const rows = db.query(
    'SELECT discovered_models FROM upstream_keys WHERE is_active = 1 AND discovered_models IS NOT NULL'
  ).all() as { discovered_models: string }[];

  const modelsSet = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.discovered_models);
      if (Array.isArray(parsed)) {
        parsed.forEach((m) => modelsSet.add(String(m)));
      }
    } catch {}
  }

  return c.json({ models: Array.from(modelsSet).sort() });
});

// GET /api/admin/keys
adminRouter.get('/keys', (c) => {
  const db = getDatabase();
  const keys = db.query('SELECT * FROM upstream_keys ORDER BY created_at DESC').all() as UpstreamKey[];

  const safeKeys = keys.map((k) => {
    let parsedModels: string[] = [];
    if (k.discovered_models) {
      try {
        const p = JSON.parse(k.discovered_models);
        if (Array.isArray(p)) parsedModels = p;
      } catch {}
    }

    let parsedSchemas: string[] = ['chat_completions', 'responses', 'embeddings', 'decision'];
    if (k.supported_schemas) {
      try {
        const val = JSON.parse(k.supported_schemas);
        if (Array.isArray(val) && val.length > 0) {
          parsedSchemas = val;
        }
      } catch {}
    } else if (k.api_schema) {
      parsedSchemas = [k.api_schema];
    }

    return {
      id: k.id,
      pool_id: k.pool_id,
      provider: k.provider,
      name: k.name,
      base_url: k.base_url,
      masked_key: '••••••••••••',
      is_active: k.is_active,
      is_free_tier: Boolean(k.is_free_tier),
      daily_token_limit: k.daily_token_limit || 0,
      current_daily_tokens: k.current_daily_tokens || 0,
      daily_tokens_reset_at: k.daily_tokens_reset_at || 0,
      budget_type: (k as any).budget_type || 'tokens',
      budget_cadence: (k as any).budget_cadence || 'daily',
      budget_limit: (k as any).budget_limit !== undefined ? (k as any).budget_limit : (k.daily_token_limit || 0),
      current_spend_tokens: (k as any).current_spend_tokens || k.current_daily_tokens || 0,
      current_spend_usd: (k as any).current_spend_usd || 0,
      spend_reset_at: (k as any).spend_reset_at || k.daily_tokens_reset_at || 0,
      cooldown_until: k.cooldown_until,
      in_cooldown: k.cooldown_until > Date.now(),
      fail_count: k.fail_count,
      last_error: k.last_error ? sanitizeErrorMessage(k.last_error) : null,
      discovered_models: parsedModels,
      api_schema: k.api_schema || 'chat_completions',
      supported_schemas: parsedSchemas,
      custom_schema_config: k.custom_schema_config || null,
      created_at: k.created_at,
      updated_at: k.updated_at,
    };
  });

  return c.json({ keys: safeKeys });
});

// POST /api/admin/keys
adminRouter.post('/keys', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateUpstreamKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: sanitizeErrorMessage(parsed.error.issues[0]?.message || 'Invalid upstream key payload') }, 400);
  }

  const {
    provider,
    name,
    base_url,
    api_key,
    pool_id,
    is_free_tier,
    daily_token_limit,
    budget_type,
    budget_cadence,
    budget_limit,
    api_schema,
    supported_schemas,
    custom_schema_config
  } = parsed.data;

  // Zero-token test & model discovery
  const discovery = await discoverModelsForProvider(provider, base_url, api_key, 5000);
  const discoveredModelsJson = discovery.success && discovery.models.length > 0
    ? JSON.stringify(discovery.models)
    : null;

  const db = getDatabase();
  const id = crypto.randomUUID();
  const encrypted_key = encryptSecret(api_key);
  const now = Date.now();
  const freeTierInt = is_free_tier ? 1 : 0;
  const bType = budget_type || 'tokens';
  const bCadence = budget_cadence || 'daily';
  const bLimit = budget_limit !== undefined && budget_limit > 0 ? budget_limit : (daily_token_limit || 0);
  const tokenLimitInt = bType === 'tokens' ? Math.floor(bLimit) : 0;
  const resetAt = calculateNextResetAt(bCadence, now);
  const schemaType = api_schema || 'chat_completions';
  const customConfigStr = custom_schema_config || null;

  let normalizedSchemas = ['chat_completions', 'responses', 'embeddings', 'decision'];
  if (supported_schemas) {
    if (Array.isArray(supported_schemas)) {
      normalizedSchemas = supported_schemas.filter(Boolean);
    } else if (typeof supported_schemas === 'string') {
      try {
        const parsed = JSON.parse(supported_schemas);
        if (Array.isArray(parsed)) normalizedSchemas = parsed;
        else normalizedSchemas = supported_schemas.split(',').map((s) => s.trim()).filter(Boolean);
      } catch {
        normalizedSchemas = supported_schemas.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
  } else if (api_schema) {
    normalizedSchemas = [api_schema];
  }
  const supportedSchemasJson = JSON.stringify(normalizedSchemas);

  // Validate pool_id exists before setting foreign key
  let validPoolId: string | null = null;
  if (pool_id) {
    const poolExists = db.query('SELECT 1 FROM pools WHERE id = ?').get(pool_id);
    if (poolExists) {
      validPoolId = pool_id;
    }
  }

  db.query(`
    INSERT INTO upstream_keys (
      id, pool_id, provider, name, base_url, encrypted_key, is_active, is_free_tier,
      daily_token_limit, current_daily_tokens, daily_tokens_reset_at,
      budget_type, budget_cadence, budget_limit, current_spend_tokens, current_spend_usd, spend_reset_at,
      cooldown_until, fail_count, last_error, discovered_models, api_schema, supported_schemas, custom_schema_config, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?, ?, ?, 0, 0, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    validPoolId,
    provider,
    name,
    base_url,
    encrypted_key,
    freeTierInt,
    tokenLimitInt,
    resetAt,
    bType,
    bCadence,
    bLimit,
    resetAt,
    discoveredModelsJson,
    schemaType,
    supportedSchemasJson,
    customConfigStr,
    now,
    now
  );

  // If validPoolId was specified, link in pool_routes automatically
  if (validPoolId) {
    const routeId = crypto.randomUUID();
    db.query(`
      INSERT OR IGNORE INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at)
      VALUES (?, ?, ?, 0, '*', ?)
    `).run(routeId, validPoolId, id, now);
  }

  return c.json({
    success: true,
    key: {
      id,
      pool_id: pool_id || null,
      provider,
      name,
      base_url,
      masked_key: maskKey(api_key),
      is_active: 1,
      is_free_tier: Boolean(freeTierInt),
      daily_token_limit: tokenLimitInt,
      current_daily_tokens: 0,
      daily_tokens_reset_at: resetAt,
      budget_type: bType,
      budget_cadence: bCadence,
      budget_limit: bLimit,
      current_spend_tokens: 0,
      current_spend_usd: 0,
      spend_reset_at: resetAt,
      cooldown_until: 0,
      fail_count: 0,
      discovered_models: discovery.models,
      api_schema: schemaType,
      supported_schemas: normalizedSchemas,
      custom_schema_config: customConfigStr,
      created_at: now,
    },
    discovery: {
      verified: discovery.success,
      models_count: discovery.models.length,
      latency_ms: discovery.latency_ms,
      error: discovery.error ? sanitizeErrorMessage(discovery.error) : undefined,
    },
  }, 201);
});

// PATCH /api/admin/keys/:id
adminRouter.patch('/keys/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateUpstreamKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: sanitizeErrorMessage(parsed.error.issues[0]?.message || 'Invalid update payload') }, 400);
  }

  const db = getDatabase();
  const existing = db.query('SELECT * FROM upstream_keys WHERE id = ?').get(id) as UpstreamKey | null;
  if (!existing) {
    return c.json({ error: 'Upstream key not found' }, 404);
  }

  const d = parsed.data;
  const name = d.name !== undefined ? d.name : existing.name;
  const pool_id = d.pool_id !== undefined ? d.pool_id : existing.pool_id;
  const provider = d.provider !== undefined ? d.provider : existing.provider;
  const base_url = d.base_url !== undefined ? d.base_url : existing.base_url;
  const is_active = d.is_active !== undefined ? (d.is_active ? 1 : 0) : existing.is_active;
  const is_free_tier = d.is_free_tier !== undefined ? (d.is_free_tier ? 1 : 0) : existing.is_free_tier;
  const budget_type = d.budget_type !== undefined ? d.budget_type : ((existing as any).budget_type || 'tokens');
  const budget_cadence = d.budget_cadence !== undefined ? d.budget_cadence : ((existing as any).budget_cadence || 'daily');
  let budget_limit = d.budget_limit !== undefined ? d.budget_limit : ((existing as any).budget_limit !== undefined ? (existing as any).budget_limit : (existing.daily_token_limit || 0));
  if (d.daily_token_limit !== undefined && d.budget_limit === undefined) {
    budget_limit = d.daily_token_limit;
  }
  const daily_token_limit = budget_type === 'tokens' ? Math.floor(budget_limit) : (d.daily_token_limit !== undefined ? d.daily_token_limit : (existing.daily_token_limit || 0));
  const api_schema = d.api_schema !== undefined ? d.api_schema : (existing.api_schema || 'chat_completions');
  const custom_schema_config = d.custom_schema_config !== undefined ? d.custom_schema_config : (existing.custom_schema_config || null);

  let supported_schemas = existing.supported_schemas;
  if (d.supported_schemas !== undefined) {
    if (d.supported_schemas === null) {
      supported_schemas = JSON.stringify(['chat_completions', 'responses', 'embeddings', 'decision']);
    } else if (Array.isArray(d.supported_schemas)) {
      supported_schemas = JSON.stringify(d.supported_schemas);
    } else if (typeof d.supported_schemas === 'string') {
      try {
        const p = JSON.parse(d.supported_schemas);
        supported_schemas = Array.isArray(p) ? JSON.stringify(p) : JSON.stringify([d.supported_schemas]);
      } catch {
        supported_schemas = JSON.stringify(d.supported_schemas.split(',').map((s) => s.trim()).filter(Boolean));
      }
    }
  } else if (d.api_schema !== undefined && !existing.supported_schemas) {
    supported_schemas = JSON.stringify([d.api_schema]);
  }

  let encrypted_key = existing.encrypted_key;
  let discovered_models = existing.discovered_models;

  if (d.api_key) {
    encrypted_key = encryptSecret(d.api_key);
    // Auto-discover models with new key
    const discovery = await discoverModelsForProvider(provider, base_url, d.api_key, 4000);
    if (discovery.success && discovery.models.length > 0) {
      discovered_models = JSON.stringify(discovery.models);
    }
  }

  const now = Date.now();
  db.query(`
    UPDATE upstream_keys
    SET name = ?, pool_id = ?, provider = ?, base_url = ?, encrypted_key = ?,
        is_active = ?, is_free_tier = ?, daily_token_limit = ?,
        budget_type = ?, budget_cadence = ?, budget_limit = ?,
        api_schema = ?, supported_schemas = ?, custom_schema_config = ?, discovered_models = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    pool_id || null,
    provider,
    base_url,
    encrypted_key,
    is_active,
    is_free_tier,
    daily_token_limit,
    budget_type,
    budget_cadence,
    budget_limit,
    api_schema,
    supported_schemas,
    custom_schema_config,
    discovered_models || null,
    now,
    id
  );

  return c.json({ success: true });
});

// POST /api/admin/keys/:id/reset-tokens
adminRouter.post('/keys/:id/reset-tokens', (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  const existing = db.query('SELECT * FROM upstream_keys WHERE id = ?').get(id) as any;
  const cadence = existing?.budget_cadence || 'daily';
  const now = Date.now();
  const nextReset = calculateNextResetAt(cadence, now);
  db.query(`
    UPDATE upstream_keys
    SET current_daily_tokens = 0, current_spend_tokens = 0, current_spend_usd = 0,
        daily_tokens_reset_at = ?, spend_reset_at = ?, updated_at = ?
    WHERE id = ?
  `).run(nextReset, nextReset, now, id);

  return c.json({ success: true, daily_tokens_reset_at: nextReset, spend_reset_at: nextReset });
});

// DELETE /api/admin/keys/:id
adminRouter.delete('/keys/:id', (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  db.run('BEGIN TRANSACTION;');
  try {
    db.query('DELETE FROM pool_routes WHERE upstream_key_id = ?').run(id);
    db.query('DELETE FROM model_pricing WHERE upstream_key_id = ?').run(id);
    db.query('DELETE FROM upstream_keys WHERE id = ?').run(id);
    db.run('COMMIT;');
    clearPricingCache();
    return c.json({ success: true });
  } catch (err: any) {
    db.run('ROLLBACK;');
    return c.json({ error: err.message }, 500);
  }
});

// POST /api/admin/keys/:id/reset-cooldown
adminRouter.post('/keys/:id/reset-cooldown', (c) => {
  const id = c.req.param('id');
  resetKeyCooldown(id);
  return c.json({ success: true });
});

// POST /api/admin/keys/:id/discover-models
// Runs a zero-token test and model discovery for an existing upstream key
adminRouter.post('/keys/:id/discover-models', async (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  const key = db.query('SELECT * FROM upstream_keys WHERE id = ?').get(id) as UpstreamKey | null;
  if (!key) {
    return c.json({ error: 'Key not found' }, 404);
  }

  const dec = decryptSecret(key.encrypted_key);
  if (!dec.success || !dec.data) {
    return c.json({ success: false, error: 'Decryption failed: ' + dec.error }, 400);
  }

  const discovery = await discoverModelsForProvider(key.provider, key.base_url, dec.data, 6000);
  const now = Date.now();

  if (discovery.success && discovery.models.length > 0) {
    db.query(`
      UPDATE upstream_keys
      SET discovered_models = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(discovery.models), now, id);
  } else if (!discovery.success) {
    db.query(`
      UPDATE upstream_keys
      SET last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(sanitizeErrorMessage(discovery.error || 'Model discovery failed'), now, id);
  }

  const safeDiscError = discovery.error ? sanitizeErrorMessage(discovery.error) : undefined;
  return c.json({
    success: discovery.success,
    status: discovery.status,
    latency_ms: discovery.latency_ms,
    models: discovery.models,
    error: safeDiscError,
    message: discovery.success
      ? `Discovered ${discovery.models.length} available models in ${discovery.latency_ms}ms (0 tokens used)`
      : (safeDiscError || 'Discovery failed'),
  });
});

// POST /api/admin/keys/:id/test
adminRouter.post('/keys/:id/test', async (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  const key = db.query('SELECT * FROM upstream_keys WHERE id = ?').get(id) as UpstreamKey | null;
  if (!key) {
    return c.json({ error: 'Key not found' }, 404);
  }

  const dec = decryptSecret(key.encrypted_key);
  if (!dec.success || !dec.data) {
    return c.json({ success: false, error: 'Decryption failed: ' + dec.error }, 400);
  }

  const discovery = await discoverModelsForProvider(key.provider, key.base_url, dec.data, 6000);
  const now = Date.now();

  if (discovery.success && discovery.models.length > 0) {
    db.query(`
      UPDATE upstream_keys
      SET discovered_models = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(discovery.models), now, id);
  } else if (!discovery.success) {
    db.query(`
      UPDATE upstream_keys
      SET last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(sanitizeErrorMessage(discovery.error || 'Connection failed'), now, id);
  }

  const safeTestError = discovery.error ? sanitizeErrorMessage(discovery.error) : undefined;
  return c.json({
    success: discovery.success,
    status: discovery.status || (discovery.success ? 200 : 500),
    latency_ms: discovery.latency_ms,
    models: discovery.models,
    message: discovery.success
      ? `Connection successful! Verified ${discovery.models.length} models in ${discovery.latency_ms}ms (0 tokens)`
      : (safeTestError || `Upstream returned status ${discovery.status}`),
    error: safeTestError,
  });
});

// ==========================================
// 2. POOLS
// ==========================================

// GET /api/admin/pools
adminRouter.get('/pools', (c) => {
  const db = getDatabase();
  const pools = db.query(`
    SELECT p.*,
           (SELECT COUNT(DISTINCT r.upstream_key_id) FROM pool_routes r WHERE r.pool_id = p.id) as key_count,
           (SELECT COUNT(v.id) FROM virtual_keys v WHERE v.pool_id = p.id) as capykey_count
    FROM pools p
    ORDER BY p.name ASC
  `).all() as any[];

  const poolsWithRoutes = pools.map((p) => {
    const routes = db.query(`
      SELECT r.id as route_id, r.priority, r.model_pattern, r.upstream_key_id,
             r.token_limit, r.current_tokens, r.cost_limit, r.current_cost, r.reasoning_effort,
             k.name as upstream_key_name, k.provider, k.is_active, k.daily_token_limit, k.current_daily_tokens
      FROM pool_routes r
      JOIN upstream_keys k ON k.id = r.upstream_key_id
      WHERE r.pool_id = ?
      ORDER BY r.priority ASC, r.created_at ASC
    `).all(p.id);

    return {
      ...p,
      budget_type: p.budget_type || 'tokens',
      budget_cadence: p.budget_cadence || 'daily',
      budget_limit: p.budget_limit || 0,
      current_spend_tokens: p.current_spend_tokens || 0,
      current_spend_usd: p.current_spend_usd || 0,
      spend_reset_at: p.spend_reset_at || 0,
      allow_cross_model_fallback: Boolean(p.allow_cross_model_fallback),
      reasoning_policy: p.reasoning_policy || 'inherit',
      routes,
    };
  });

  return c.json({ pools: poolsWithRoutes });
});

// POST /api/admin/pools
adminRouter.post('/pools', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreatePoolSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid pool payload' }, 400);
  }

  const { id, name, description, budget_type = 'tokens', budget_cadence = 'daily', budget_limit = 0, allow_cross_model_fallback, reasoning_policy = 'inherit' } = parsed.data;
  const db = getDatabase();
  const now = Date.now();
  const resetAt = calculateNextResetAt(budget_cadence, now);
  const crossFallbackInt = allow_cross_model_fallback ? 1 : 0;

  try {
    db.query(`
      INSERT INTO pools (
        id, name, description, budget_type, budget_cadence, budget_limit,
        current_spend_tokens, current_spend_usd, spend_reset_at, allow_cross_model_fallback, reasoning_policy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    `).run(id.trim(), name.trim(), description || null, budget_type, budget_cadence, budget_limit, resetAt, crossFallbackInt, reasoning_policy, now, now);
    return c.json({ success: true, id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Pool creation failed' }, 400);
  }
});

// PATCH /api/admin/pools/:id
adminRouter.patch('/pools/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdatePoolSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid pool update payload' }, 400);
  }

  const db = getDatabase();
  const existing = db.query('SELECT * FROM pools WHERE id = ?').get(id) as Pool | null;
  if (!existing) {
    return c.json({ error: 'Pool not found' }, 404);
  }

  const now = Date.now();
  const name = parsed.data.name !== undefined ? parsed.data.name : existing.name;
  const description = parsed.data.description !== undefined ? parsed.data.description : existing.description;
  const budget_type = parsed.data.budget_type !== undefined ? parsed.data.budget_type : existing.budget_type;
  const budget_cadence = parsed.data.budget_cadence !== undefined ? parsed.data.budget_cadence : existing.budget_cadence;
  const budget_limit = parsed.data.budget_limit !== undefined ? parsed.data.budget_limit : existing.budget_limit;
  const allow_cross_model_fallback = parsed.data.allow_cross_model_fallback !== undefined
    ? (parsed.data.allow_cross_model_fallback ? 1 : 0)
    : (existing.allow_cross_model_fallback || 0);
  const reasoning_policy = parsed.data.reasoning_policy !== undefined
    ? parsed.data.reasoning_policy
    : (existing.reasoning_policy || 'inherit');

  db.query(`
    UPDATE pools
    SET name = ?, description = ?, budget_type = ?, budget_cadence = ?, budget_limit = ?, allow_cross_model_fallback = ?, reasoning_policy = ?, updated_at = ?
    WHERE id = ?
  `).run(name, description, budget_type, budget_cadence, budget_limit, allow_cross_model_fallback, reasoning_policy, now, id);

  return c.json({ success: true });
});

// POST /api/admin/pools/:id/routes (Configure or reorder pool routes & priorities)
adminRouter.post('/pools/:id/routes', async (c) => {
  const poolId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = SetPoolRoutesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid routes payload' }, 400);
  }

  const db = getDatabase();
  const pool = db.query('SELECT id FROM pools WHERE id = ?').get(poolId);
  if (!pool) return c.json({ error: 'Pool not found' }, 404);

  db.run('BEGIN TRANSACTION;');
  try {
    const existingRoutes = db.query('SELECT * FROM pool_routes WHERE pool_id = ?').all(poolId) as any[];
    const existingMap = new Map(existingRoutes.map((er) => [er.id, er]));

    db.query('DELETE FROM pool_routes WHERE pool_id = ?').run(poolId);
    const now = Date.now();
    for (const r of parsed.data.routes) {
      const routeId = r.id || crypto.randomUUID();
      const existing = r.id ? existingMap.get(r.id) : null;
      const curTokens = existing ? existing.current_tokens : 0;
      const curCost = existing ? existing.current_cost : 0;
      const tokLimit = r.token_limit !== undefined ? r.token_limit : (existing ? existing.token_limit : 0);
      const cstLimit = r.cost_limit !== undefined ? r.cost_limit : (existing ? existing.cost_limit : 0);
      const reasoningEffort = r.reasoning_effort !== undefined ? (r.reasoning_effort || null) : (existing ? (existing.reasoning_effort || null) : null);

      db.query(`
        INSERT INTO pool_routes (
          id, pool_id, upstream_key_id, priority, model_pattern,
          token_limit, current_tokens, cost_limit, current_cost, reasoning_effort, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(routeId, poolId, r.upstream_key_id, r.priority, r.model_pattern || '*', tokLimit, curTokens, cstLimit, curCost, reasoningEffort, now);
    }
    db.run('COMMIT;');
  } catch (err: any) {
    db.run('ROLLBACK;');
    return c.json({ error: err.message }, 500);
  }

  return c.json({ success: true });
});

// POST /api/admin/pools/:id/routes/:routeId/reset
adminRouter.post('/pools/:id/routes/:routeId/reset', (c) => {
  const routeId = c.req.param('routeId');
  const db = getDatabase();
  db.query(`
    UPDATE pool_routes
    SET current_tokens = 0, current_cost = 0
    WHERE id = ?
  `).run(routeId);
  return c.json({ success: true });
});

// DELETE /api/admin/pools/:id
adminRouter.delete('/pools/:id', (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  db.run('BEGIN TRANSACTION;');
  try {
    db.query('DELETE FROM pool_routes WHERE pool_id = ?').run(id);
    db.query('UPDATE virtual_keys SET pool_id = NULL WHERE pool_id = ?').run(id);
    db.query('UPDATE upstream_keys SET pool_id = NULL WHERE pool_id = ?').run(id);
    db.query('DELETE FROM pools WHERE id = ?').run(id);
    db.run('COMMIT;');
    resetPoolCounter(id);
    return c.json({ success: true });
  } catch (err: any) {
    db.run('ROLLBACK;');
    return c.json({ error: err.message }, 500);
  }
});

// ==========================================
// 3. CAPYKEYS (VIRTUAL KEYS)
// ==========================================

// GET /api/admin/virtual-keys
adminRouter.get('/virtual-keys', (c) => {
  const db = getDatabase();
  const keys = db.query(`
    SELECT v.id, v.name, v.key_prefix, v.pool_id, p.name as pool_name, v.rate_limit_rpm,
           v.budget_type, v.budget_cadence, v.budget_limit, v.budget_monthly_usd,
           v.current_spend_usd, v.current_spend_tokens, v.spend_reset_at,
           v.allowed_pools, v.allowed_models, v.is_active, v.created_at, v.updated_at
    FROM virtual_keys v
    LEFT JOIN pools p ON p.id = v.pool_id
    ORDER BY v.created_at DESC
  `).all() as (VirtualKey & { pool_name?: string })[];

  return c.json({ virtual_keys: keys });
});

// POST /api/admin/virtual-keys
adminRouter.post('/virtual-keys', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateVirtualKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid virtual key payload' }, 400);
  }

  const {
    name,
    pool_id,
    rate_limit_rpm,
    budget_type = 'tokens',
    budget_cadence = 'daily',
    budget_limit,
    budget_monthly_usd,
    allowed_pools,
    allowed_models,
    include_metadata = true,
  } = parsed.data;

  const resolvedLimit = (budget_limit !== undefined && budget_limit > 0)
    ? budget_limit
    : (budget_monthly_usd || 0);

  const generated = generateVirtualKey();
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();
  const initialResetAt = calculateNextResetAt(budget_cadence, now);

  const poolsJson = normalizeArrayParam(allowed_pools);
  const modelsJson = normalizeArrayParam(allowed_models);
  const includeMetadataVal = include_metadata === false || (include_metadata as any) === 0 ? 0 : 1;

  db.query(`
    INSERT INTO virtual_keys (
      id, name, key_hash, key_prefix, pool_id, rate_limit_rpm,
      budget_type, budget_cadence, budget_limit, budget_monthly_usd,
      current_spend_usd, current_spend_tokens, spend_reset_at,
      allowed_pools, allowed_models, include_metadata, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    name,
    generated.keyHash,
    generated.keyPrefix,
    pool_id || null,
    rate_limit_rpm || 0,
    budget_type,
    budget_cadence,
    resolvedLimit,
    budget_type === 'usd' ? resolvedLimit : (budget_monthly_usd || 0),
    initialResetAt,
    poolsJson,
    modelsJson,
    includeMetadataVal,
    now,
    now
  );

  return c.json({
    success: true,
    virtual_key: {
      id,
      name,
      pool_id: pool_id || null,
      key_prefix: generated.keyPrefix,
      full_key: generated.fullKey, // Returned ONCE for user to copy
      rate_limit_rpm: rate_limit_rpm || 0,
      budget_type,
      budget_cadence,
      budget_limit: resolvedLimit,
      budget_monthly_usd: budget_type === 'usd' ? resolvedLimit : (budget_monthly_usd || 0),
      current_spend_usd: 0,
      current_spend_tokens: 0,
      spend_reset_at: initialResetAt,
      created_at: now,
    },
  }, 201);
});

// PATCH /api/admin/virtual-keys/:id
adminRouter.patch('/virtual-keys/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateVirtualKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid virtual key update payload' }, 400);
  }

  const db = getDatabase();
  const existing = db.query('SELECT * FROM virtual_keys WHERE id = ?').get(id) as VirtualKey | null;
  if (!existing) {
    return c.json({ error: 'Virtual key not found' }, 404);
  }

  const d = parsed.data;
  const name = d.name !== undefined ? d.name : existing.name;
  const pool_id = d.pool_id !== undefined ? d.pool_id : existing.pool_id;
  const rate_limit_rpm = d.rate_limit_rpm !== undefined ? d.rate_limit_rpm : existing.rate_limit_rpm;
  const budget_type = d.budget_type !== undefined ? d.budget_type : existing.budget_type;
  const budget_cadence = d.budget_cadence !== undefined ? d.budget_cadence : existing.budget_cadence;
  const budget_limit = d.budget_limit !== undefined
    ? d.budget_limit
    : (d.budget_monthly_usd !== undefined ? d.budget_monthly_usd : existing.budget_limit);
  const budget_monthly_usd = budget_type === 'usd' ? budget_limit : existing.budget_monthly_usd;
  const is_active = d.is_active !== undefined ? (d.is_active ? 1 : 0) : existing.is_active;

  const allowed_pools = d.allowed_pools !== undefined ? normalizeArrayParam(d.allowed_pools) : existing.allowed_pools;
  const allowed_models = d.allowed_models !== undefined ? normalizeArrayParam(d.allowed_models) : existing.allowed_models;
  const include_metadata = d.include_metadata !== undefined ? (d.include_metadata ? 1 : 0) : existing.include_metadata;

  const now = Date.now();
  db.query(`
    UPDATE virtual_keys
    SET name = ?, pool_id = ?, rate_limit_rpm = ?, budget_type = ?, budget_cadence = ?,
        budget_limit = ?, budget_monthly_usd = ?, is_active = ?,
        allowed_pools = ?, allowed_models = ?, include_metadata = ?, updated_at = ?
    WHERE id = ?
  `).run(name, pool_id || null, rate_limit_rpm, budget_type, budget_cadence, budget_limit, budget_monthly_usd, is_active, allowed_pools, allowed_models, include_metadata, now, id);

  return c.json({ success: true });
});

// POST /api/admin/virtual-keys/:id/reset-spend
adminRouter.post('/virtual-keys/:id/reset-spend', (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  const existing = db.query('SELECT budget_cadence FROM virtual_keys WHERE id = ?').get(id) as { budget_cadence?: string } | null;
  const now = Date.now();
  const nextReset = existing?.budget_cadence
    ? calculateNextResetAt(existing.budget_cadence as any, now)
    : calculateNextResetAt('monthly', now);

  db.query(
    'UPDATE virtual_keys SET current_spend_usd = 0, current_spend_tokens = 0, spend_reset_at = ?, updated_at = ? WHERE id = ?'
  ).run(nextReset, now, id);
  return c.json({ success: true });
});

// DELETE /api/admin/virtual-keys/:id
adminRouter.delete('/virtual-keys/:id', (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  db.query('DELETE FROM virtual_keys WHERE id = ?').run(id);
  return c.json({ success: true });
});

// ==========================================
// 4. REQUEST LOGS
// ==========================================

// GET /api/admin/logs
adminRouter.get('/logs', (c) => {
  const db = getDatabase();
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const modelFilter = c.req.query('model');
  const providerFilter = c.req.query('provider');

  let whereClauses: string[] = [];
  let params: any[] = [];

  if (modelFilter) {
    whereClauses.push('model = ?');
    params.push(modelFilter);
  }
  if (providerFilter) {
    whereClauses.push('provider = ?');
    params.push(providerFilter);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const logs = db.query(`
    SELECT r.*,
      r.total_tokens as tokens_total,
      r.prompt_tokens as tokens_prompt,
      r.completion_tokens as tokens_completion,
      v.name as virtual_key_name,
      k.name as upstream_key_name,
      p.name as pool_name,
      k.is_free_tier as upstream_is_free_tier
    FROM request_logs r
    LEFT JOIN virtual_keys v ON v.id = r.virtual_key_id
    LEFT JOIN upstream_keys k ON k.id = r.upstream_key_id
    LEFT JOIN pools p ON p.id = r.pool_id
    ${whereStr}
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as (RequestLog & { virtual_key_name?: string; upstream_key_name?: string; pool_name?: string; upstream_is_free_tier?: number })[];

  const countRow = db.query(`SELECT COUNT(*) as total FROM request_logs ${whereStr}`).get(...params) as { total: number };

  return c.json({
    logs,
    total: countRow.total,
    limit,
    offset,
  });
});

// ==========================================
// 5. STATS
// ==========================================

// GET /api/admin/stats
adminRouter.get('/stats', (c) => {
  const db = getDatabase();
  const now = Date.now();

  const aggregate = db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
      COALESCE(SUM(cost_usd), 0) as total_spend_usd,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COALESCE(AVG(ttft_ms), 0) as avg_ttft_ms,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as error_count
    FROM request_logs
  `).get() as any;

  // Stats today (since 00:00 UTC)
  const startOfTodayUtc = new Date(now);
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);
  const todayMidnightMs = startOfTodayUtc.getTime();

  const todayAggregate = db.query(`
    SELECT
      COUNT(*) as requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM request_logs
    WHERE created_at >= ?
  `).get(todayMidnightMs) as any;

  // Upstream quotas (e.g. 2,500,000 daily token limits)
  const quotaStats = db.query(`
    SELECT
      COALESCE(SUM(daily_token_limit), 0) as daily_token_limit,
      COALESCE(SUM(current_daily_tokens), 0) as current_daily_tokens
    FROM upstream_keys
    WHERE is_active = 1
  `).get() as any;

  // Usage broken down by App (CapyKey)
  const rawByApp = db.query(`
    SELECT
      COALESCE(v.name, 'Admin / Chiamata Diretta') as app_name,
      COALESCE(r.virtual_key_id, 'direct') as app_id,
      COUNT(r.id) as requests,
      COALESCE(SUM(r.total_tokens), 0) as total_tokens,
      COALESCE(SUM(r.prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(r.completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(r.cost_usd), 0) as cost_usd
    FROM request_logs r
    LEFT JOIN virtual_keys v ON v.id = r.virtual_key_id
    GROUP BY r.virtual_key_id
    ORDER BY total_tokens DESC
  `).all() as any[];

  const totalToks = aggregate.total_tokens > 0 ? aggregate.total_tokens : 1;
  const byApp = rawByApp.map((a) => ({
    ...a,
    cost_usd: Number(a.cost_usd.toFixed(4)),
    percentage: Math.round((a.total_tokens / totalToks) * 100),
  }));

  // Usage broken down by Model & Provider
  const rawByModel = db.query(`
    SELECT
      r.model,
      r.provider,
      COUNT(r.id) as requests,
      COALESCE(SUM(r.total_tokens), 0) as total_tokens,
      COALESCE(SUM(r.prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(r.completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(r.cost_usd), 0) as cost_usd,
      COALESCE(AVG(r.latency_ms), 0) as avg_latency_ms,
      COALESCE(AVG(r.ttft_ms), 0) as avg_ttft_ms
    FROM request_logs r
    GROUP BY r.model, r.provider
    ORDER BY total_tokens DESC
  `).all() as any[];

  const byModel = rawByModel.map((m) => ({
    ...m,
    cost_usd: Number(m.cost_usd.toFixed(4)),
    avg_latency_ms: Math.round(m.avg_latency_ms),
    avg_ttft_ms: Math.round(m.avg_ttft_ms),
    percentage: Math.round((m.total_tokens / totalToks) * 100),
  }));

  const keyStats = db.query(`
    SELECT
      COUNT(*) as total_keys,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_keys,
      SUM(CASE WHEN cooldown_until > ? THEN 1 ELSE 0 END) as cooling_down_keys
    FROM upstream_keys
  `).get(now) as any;

  const errorRate = aggregate.total_requests > 0
    ? Number(((aggregate.error_count / aggregate.total_requests) * 100).toFixed(1))
    : 0;

  // 24-hour activity trend (hourly buckets)
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
  const rawHourly = db.query(`
    SELECT
      strftime('%Y-%m-%d %H:00', datetime(created_at / 1000, 'unixepoch')) as hour_str,
      COUNT(id) as requests,
      COALESCE(SUM(total_tokens), 0) as tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM request_logs
    WHERE created_at >= ?
    GROUP BY hour_str
    ORDER BY hour_str ASC
  `).all(twentyFourHoursAgo) as any[];

  const hourlyMap = new Map<string, any>(rawHourly.map((h) => [h.hour_str, h]));
  const hourly_activity: Array<{ hour: string; label: string; requests: number; tokens: number; cost_usd: number }> = [];

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 60 * 60 * 1000);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hour = String(d.getUTCHours()).padStart(2, '0');
    const key = `${year}-${month}-${day} ${hour}:00`;
    const label = `${hour}:00`;

    const match = hourlyMap.get(key);
    hourly_activity.push({
      hour: key,
      label,
      requests: match ? match.requests : 0,
      tokens: match ? match.tokens : 0,
      cost_usd: match ? Number(match.cost_usd.toFixed(4)) : 0,
    });
  }

  // Provider reliability and speed leaderboard across all models:
  // Only 5xx server errors and connection aborts count as provider unreliability.
  // 4xx errors (except 429) are client-side validation errors (e.g. invalid parameter) and do NOT penalize provider uptime.
  const rawProviderStats = db.query(`
    SELECT
      r.provider,
      COUNT(r.id) as total_requests,
      COALESCE(SUM(CASE WHEN r.status_code >= 200 AND r.status_code < 300 THEN 1 ELSE 0 END), 0) as success_requests,
      COALESCE(SUM(CASE WHEN r.status_code = 429 THEN 1 ELSE 0 END), 0) as rate_limit_429_count,
      COALESCE(SUM(CASE WHEN r.status_code >= 500 OR r.status_code = 0 THEN 1 ELSE 0 END), 0) as server_failures,
      COALESCE(SUM(CASE WHEN r.status_code >= 400 AND r.status_code < 500 AND r.status_code != 429 THEN 1 ELSE 0 END), 0) as client_error_count,
      COALESCE(AVG(r.latency_ms), 0) as avg_latency_ms,
      COALESCE(AVG(CASE WHEN r.ttft_ms > 0 THEN r.ttft_ms ELSE NULL END), 0) as avg_ttft_ms,
      COALESCE(SUM(r.total_tokens), 0) as total_tokens,
      COALESCE(SUM(r.completion_tokens), 0) as completion_tokens
    FROM request_logs r
    GROUP BY r.provider
    ORDER BY total_requests DESC
  `).all() as any[];

  const provider_reliability = rawProviderStats.map((p) => {
    const total = p.total_requests || 1;
    const serverFailures = p.server_failures || 0;
    // Uptime percentage: excludes client 4xx validation errors
    const successPct = Number((((total - serverFailures) / total) * 100).toFixed(1));
    const avgLatency = Math.round(p.avg_latency_ms);
    const avgTtft = Math.round(p.avg_ttft_ms);
    const tokPerSec = avgLatency > 0 && p.completion_tokens > 0
      ? Number(((p.completion_tokens / ((avgLatency / 1000) * p.total_requests))).toFixed(1))
      : 0;

    return {
      provider: p.provider,
      provider_logo_url: getProviderLogoUrl(p.provider),
      total_requests: p.total_requests,
      success_requests: p.success_requests,
      server_failures: serverFailures,
      client_error_count: p.client_error_count,
      success_rate_pct: successPct,
      rate_limit_429_count: p.rate_limit_429_count,
      avg_latency_ms: avgLatency,
      avg_ttft_ms: avgTtft,
      total_tokens: p.total_tokens,
      completion_tokens: p.completion_tokens,
      tokens_per_sec: tokPerSec,
    };
  });

  return c.json({
    total_requests: aggregate.total_requests,
    total_tokens: aggregate.total_tokens,
    total_prompt_tokens: aggregate.total_prompt_tokens,
    total_completion_tokens: aggregate.total_completion_tokens,
    total_spend_usd: Number(aggregate.total_spend_usd.toFixed(4)),
    avg_latency_ms: Math.round(aggregate.avg_latency_ms),
    avg_ttft_ms: Math.round(aggregate.avg_ttft_ms),
    error_rate_pct: errorRate,
    total_keys: keyStats.total_keys || 0,
    active_keys: keyStats.active_keys || 0,
    cooling_down_keys: keyStats.cooling_down_keys || 0,
    today: {
      requests: todayAggregate.requests || 0,
      total_tokens: todayAggregate.total_tokens || 0,
      prompt_tokens: todayAggregate.prompt_tokens || 0,
      completion_tokens: todayAggregate.completion_tokens || 0,
      cost_usd: Number((todayAggregate.cost_usd || 0).toFixed(4)),
    },
    quota: {
      daily_token_limit: quotaStats.daily_token_limit || 0,
      current_daily_tokens: quotaStats.current_daily_tokens || 0,
    },
    hourly_activity,
    by_app: byApp,
    by_model: byModel,
    provider_reliability,
  });
});

// GET /api/admin/stats/provider/:provider
// Detailed analytics for a specific provider: model breakdown, requests, tokens, latency and speed
adminRouter.get('/stats/provider/:provider', (c) => {
  const providerParam = decodeURIComponent(c.req.param('provider'));
  const db = getDatabase();

  const models = db.query(`
    SELECT
      r.model,
      COUNT(r.id) as requests,
      COALESCE(SUM(r.total_tokens), 0) as total_tokens,
      COALESCE(SUM(r.prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(r.completion_tokens), 0) as completion_tokens,
      COALESCE(AVG(r.latency_ms), 0) as avg_latency_ms,
      COALESCE(AVG(CASE WHEN r.ttft_ms > 0 THEN r.ttft_ms ELSE NULL END), 0) as avg_ttft_ms,
      COALESCE(SUM(r.cost_usd), 0) as total_cost_usd,
      COALESCE(SUM(CASE WHEN r.status_code >= 200 AND r.status_code < 300 THEN 1 ELSE 0 END), 0) as success_count,
      COALESCE(SUM(CASE WHEN r.status_code = 429 THEN 1 ELSE 0 END), 0) as rate_limit_429_count
    FROM request_logs r
    WHERE r.provider = ?
    GROUP BY r.model
    ORDER BY requests DESC
  `).all(providerParam) as any[];

  return c.json({
    provider: providerParam,
    provider_logo_url: getProviderLogoUrl(providerParam),
    models: models.map((m) => {
      const avgLat = Math.round(m.avg_latency_ms);
      const tokPerSec = avgLat > 0 && m.completion_tokens > 0
        ? Number(((m.completion_tokens / ((avgLat / 1000) * m.requests))).toFixed(1))
        : 0;
      return {
        model: m.model,
        requests: m.requests,
        total_tokens: m.total_tokens,
        prompt_tokens: m.prompt_tokens,
        completion_tokens: m.completion_tokens,
        avg_latency_ms: avgLat,
        avg_ttft_ms: Math.round(m.avg_ttft_ms),
        tokens_per_sec: tokPerSec,
        cost_usd: Number(m.total_cost_usd.toFixed(4)),
        success_count: m.success_count,
        rate_limit_429_count: m.rate_limit_429_count,
      };
    }),
  });
});

// GET /api/admin/stats/model/:model
// Detailed analytics for a specific model: provider comparison, app consumers, latency & token breakdown
adminRouter.get('/stats/model/:model', (c) => {
  const modelParam = decodeURIComponent(c.req.param('model'));
  const canonical = stripProviderPrefix(modelParam);
  const pattern = `%/${canonical}`;
  const db = getDatabase();

  const aggregate = db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
      COALESCE(SUM(cost_usd), 0) as total_spend_usd,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COALESCE(AVG(ttft_ms), 0) as avg_ttft_ms,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as error_count
    FROM request_logs
    WHERE (model = ? OR model = ? OR model LIKE ?)
  `).get(modelParam, canonical, pattern) as any;

  const totalReqs = aggregate.total_requests > 0 ? aggregate.total_requests : 1;

  // Breakdown by provider for this model
  const rawProviders = db.query(`
    SELECT
      r.provider,
      COUNT(r.id) as requests,
      COALESCE(SUM(r.total_tokens), 0) as total_tokens,
      COALESCE(SUM(r.prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(r.completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(r.cost_usd), 0) as cost_usd,
      COALESCE(AVG(r.latency_ms), 0) as avg_latency_ms,
      COALESCE(AVG(r.ttft_ms), 0) as avg_ttft_ms,
      COALESCE(SUM(CASE WHEN r.status_code >= 400 THEN 1 ELSE 0 END), 0) as error_count
    FROM request_logs r
    WHERE (r.model = ? OR r.model = ? OR r.model LIKE ?)
    GROUP BY r.provider
    ORDER BY requests DESC
  `).all(modelParam, canonical, pattern) as any[];

  const byProvider = rawProviders.map((p) => {
    const reqs = p.requests || 1;
    const avgLat = Math.round(p.avg_latency_ms);
    const tokPerSec = avgLat > 0 && p.completion_tokens > 0
      ? Number(((p.completion_tokens / ((avgLat / 1000) * reqs))).toFixed(1))
      : 0;

    return {
      ...p,
      cost_usd: Number(p.cost_usd.toFixed(4)),
      avg_latency_ms: avgLat,
      avg_ttft_ms: Math.round(p.avg_ttft_ms),
      tokens_per_sec: tokPerSec,
      share_pct: Math.round((p.requests / totalReqs) * 100),
    };
  });

  // Breakdown by app (CapyKey) for this model
  const rawApps = db.query(`
    SELECT
      COALESCE(v.name, 'Admin / Chiamata Diretta') as app_name,
      COALESCE(r.virtual_key_id, 'direct') as app_id,
      COUNT(r.id) as requests,
      COALESCE(SUM(r.total_tokens), 0) as total_tokens,
      COALESCE(SUM(r.cost_usd), 0) as cost_usd
    FROM request_logs r
    LEFT JOIN virtual_keys v ON v.id = r.virtual_key_id
    WHERE (r.model = ? OR r.model = ? OR r.model LIKE ?)
    GROUP BY r.virtual_key_id
    ORDER BY total_tokens DESC
  `).all(modelParam, canonical, pattern) as any[];

  const byApp = rawApps.map((a) => ({
    ...a,
    cost_usd: Number(a.cost_usd.toFixed(4)),
    share_pct: Math.round((a.requests / totalReqs) * 100),
  }));

  return c.json({
    model: modelParam,
    total_requests: aggregate.total_requests,
    total_tokens: aggregate.total_tokens,
    total_prompt_tokens: aggregate.total_prompt_tokens,
    total_completion_tokens: aggregate.total_completion_tokens,
    total_spend_usd: Number(aggregate.total_spend_usd.toFixed(4)),
    avg_latency_ms: Math.round(aggregate.avg_latency_ms),
    avg_ttft_ms: Math.round(aggregate.avg_ttft_ms),
    error_count: aggregate.error_count,
    success_rate_pct: aggregate.total_requests > 0
      ? Number((((aggregate.total_requests - aggregate.error_count) / aggregate.total_requests) * 100).toFixed(1))
      : 100,
    by_provider: byProvider,
    by_app: byApp,
  });
});

// ==========================================
// 6. MODEL PRICING & TOKEN RATES
// ==========================================

// GET /api/admin/pricing
adminRouter.get('/pricing', (c) => {
  const db = getDatabase();
  const rules = db.query(`
    SELECT
      p.*,
      k.name as upstream_key_name,
      k.provider as upstream_key_provider,
      v.name as capy_key_name
    FROM model_pricing p
    LEFT JOIN upstream_keys k ON k.id = p.upstream_key_id
    LEFT JOIN virtual_keys v ON v.id = p.capy_key_id
    ORDER BY p.created_at DESC
  `).all();
  return c.json({ rules });
});

// GET /api/admin/models-catalog
// Returns unique discovered models grouped by tag, enriched with live models.dev metadata & per-provider rates
adminRouter.get('/models-catalog', async (c) => {
  const db = getDatabase();
  const keys = db.query(`
    SELECT id, name, provider, is_free_tier, discovered_models
    FROM upstream_keys
    WHERE is_active = 1
    ORDER BY name ASC
  `).all() as any[];

  const rules = db.query('SELECT * FROM model_pricing').all() as ModelPricing[];

  const catalogMap = new Map<string, {
    metadata: {
      name: string;
      description?: string;
      family?: string;
      modalities: { input: string[]; output: string[] };
      limit: { context?: number; output?: number };
      reasoning: boolean;
      reasoning_options?: any[];
      toolCall: boolean;
      structuredOutput?: boolean;
      attachment: boolean;
      temperature: boolean;
      openWeights?: boolean;
      releaseDate?: string;
      lastUpdated?: string;
      knowledge?: string;
      canonicalModelId?: string;
      sourceProvider?: string;
      rawMetadata?: any;
    };
    aliases: Set<string>;
    providers: Array<{
      key_id: string;
      key_name: string;
      provider: string;
      provider_logo_url: string;
      upstream_model: string;
      is_free_tier: boolean;
      prompt_price_per_1m: number;
      completion_price_per_1m: number;
      pricing_rule_id?: string;
    }>;
  }>();

  for (const k of keys) {
    let models: string[] = [];
    if (k.discovered_models) {
      try {
        const parsed = JSON.parse(k.discovered_models);
        if (Array.isArray(parsed)) models = parsed;
      } catch {}
    }

    // Default fallback if no models synced yet
    if (models.length === 0) {
      const preset = PROVIDER_PRESETS.find((p) => p.id === k.provider);
      if (preset && preset.defaultModels) {
        models = preset.defaultModels;
      }
    }

    for (const model of models) {
      const meta = await getEnrichedModelMetadata(k.provider, model);
      const canonicalModel = stripProviderPrefix(model);

      if (!catalogMap.has(canonicalModel)) {
        catalogMap.set(canonicalModel, {
          metadata: {
            name: meta?.name || canonicalModel,
            description: meta?.description,
            family: meta?.family,
            modalities: meta?.modalities || { input: ['text'], output: ['text'] },
            limit: meta?.limit || { context: 128000, output: 4096 },
            reasoning: meta?.reasoning || false,
            reasoning_options: meta?.reasoning_options,
            toolCall: meta?.toolCall ?? true,
            structuredOutput: meta?.structuredOutput ?? true,
            attachment: meta?.attachment || false,
            temperature: meta?.temperature ?? true,
            openWeights: meta?.openWeights,
            releaseDate: meta?.releaseDate,
            lastUpdated: meta?.lastUpdated,
            knowledge: meta?.knowledge,
            canonicalModelId: meta?.canonicalModelId,
            sourceProvider: meta?.sourceProvider,
            rawMetadata: meta?.rawMetadata,
          },
          aliases: new Set<string>(),
          providers: [],
        });
      }

      const entry = catalogMap.get(canonicalModel)!;
      if (model !== canonicalModel) {
        entry.aliases.add(model);
      }

      const rule = rules.find(
        (r) =>
          (r.upstream_key_id === k.id && (r.model === model || r.model === canonicalModel)) ||
          (r.provider === k.provider && (r.model === model || r.model === canonicalModel)) ||
          (!r.provider && !r.upstream_key_id && (r.model === model || r.model === canonicalModel))
      );

      // Real models.dev pricing:
      // 1. Custom rule override
      // 2. Free tier ($0.00)
      // 3. Live models.dev input/output cost
      // 4. Default 0.00
      let promptPrice = 0;
      let completionPrice = 0;

      if (rule) {
        promptPrice = rule.prompt_price_per_1m;
        completionPrice = rule.completion_price_per_1m;
      } else if (k.is_free_tier) {
        promptPrice = 0;
        completionPrice = 0;
      } else if (meta?.cost.input !== undefined && meta?.cost.output !== undefined) {
        promptPrice = meta.cost.input;
        completionPrice = meta.cost.output;
      }

      entry.providers.push({
        key_id: k.id,
        key_name: k.name,
        provider: k.provider,
        provider_logo_url: getProviderLogoUrl(k.provider),
        upstream_model: model,
        is_free_tier: Boolean(k.is_free_tier),
        prompt_price_per_1m: promptPrice,
        completion_price_per_1m: completionPrice,
        pricing_rule_id: rule?.id,
      });
    }
  }

  const catalog = Array.from(catalogMap.entries()).map(([canonicalModel, item]) => ({
    model: canonicalModel,
    aliases: Array.from(item.aliases).filter((a) => a !== canonicalModel),
    metadata: item.metadata,
    providers_count: item.providers.length,
    providers: item.providers,
  })).sort((a, b) => a.model.localeCompare(b.model));

  return c.json({ catalog });
});

// POST /api/admin/models-dev/sync
// Manually triggers a fresh sync from https://models.dev/api.json?type=all
adminRouter.post('/models-dev/sync', async (c) => {
  try {
    const catalog = await getModelsDevCatalog(true);
    const providerCount = Object.keys(catalog).length;
    let modelCount = 0;
    for (const p of Object.values(catalog)) {
      if (p.models) modelCount += Object.keys(p.models).length;
    }
    return c.json({
      success: true,
      providers_count: providerCount,
      models_count: modelCount,
      refreshed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to sync models.dev catalog' }, 500);
  }
});

// POST /api/admin/pricing
adminRouter.post('/pricing', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreatePricingRuleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid pricing rule' }, 400);
  }

  const { model, provider, upstream_key_id, capy_key_id, prompt_price_per_1m, completion_price_per_1m } = parsed.data;
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    db.query(`
      INSERT INTO model_pricing (
        id, model, provider, upstream_key_id, capy_key_id,
        prompt_price_per_1m, completion_price_per_1m, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      model.trim(),
      provider?.trim() || null,
      upstream_key_id || null,
      capy_key_id || null,
      prompt_price_per_1m,
      completion_price_per_1m,
      now,
      now
    );
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to insert pricing rule' }, 400);
  }

  clearPricingCache();

  return c.json({
    success: true,
    rule: {
      id,
      model: model.trim(),
      provider: provider?.trim() || null,
      upstream_key_id: upstream_key_id || null,
      capy_key_id: capy_key_id || null,
      prompt_price_per_1m,
      completion_price_per_1m,
      created_at: now,
      updated_at: now,
    },
  }, 201);
});

// PATCH /api/admin/pricing/:id
adminRouter.patch('/pricing/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdatePricingRuleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid update payload' }, 400);
  }

  const db = getDatabase();
  const existing = db.query('SELECT * FROM model_pricing WHERE id = ?').get(id) as ModelPricing | null;
  if (!existing) {
    return c.json({ error: 'Pricing rule not found' }, 404);
  }

  const d = parsed.data;
  const model = d.model !== undefined ? d.model.trim() : existing.model;
  const provider = d.provider !== undefined ? (d.provider ? d.provider.trim() : null) : existing.provider;
  const upstream_key_id = d.upstream_key_id !== undefined ? (d.upstream_key_id || null) : existing.upstream_key_id;
  const capy_key_id = d.capy_key_id !== undefined ? (d.capy_key_id || null) : existing.capy_key_id;
  const prompt_price_per_1m = d.prompt_price_per_1m !== undefined ? d.prompt_price_per_1m : existing.prompt_price_per_1m;
  const completion_price_per_1m = d.completion_price_per_1m !== undefined ? d.completion_price_per_1m : existing.completion_price_per_1m;
  const now = Date.now();

  try {
    db.query(`
      UPDATE model_pricing
      SET model = ?, provider = ?, upstream_key_id = ?, capy_key_id = ?,
          prompt_price_per_1m = ?, completion_price_per_1m = ?, updated_at = ?
      WHERE id = ?
    `).run(model, provider, upstream_key_id, capy_key_id, prompt_price_per_1m, completion_price_per_1m, now, id);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update pricing rule' }, 400);
  }

  clearPricingCache();
  return c.json({ success: true });
});

// DELETE /api/admin/pricing/:id
adminRouter.delete('/pricing/:id', (c) => {
  const id = c.req.param('id');
  const db = getDatabase();
  db.query('DELETE FROM model_pricing WHERE id = ?').run(id);
  clearPricingCache();
  return c.json({ success: true });
});

// ==========================================
// 7. TELEGRAM WEBHOOK NOTIFICATIONS
// ==========================================

// GET /api/admin/telegram
adminRouter.get('/telegram', (c) => {
  const config = getTelegramConfig();
  return c.json({
    is_enabled: config.isEnabled,
    has_bot_token: Boolean(config.botToken),
    chat_id: config.chatId || '',
    notify_on_budget_warning: config.notifyOnBudgetWarning,
    notify_on_budget_exceeded: config.notifyOnBudgetExceeded,
    notify_on_key_cooldown: config.notifyOnKeyCooldown,
    notify_on_key_error: config.notifyOnKeyError,
  });
});

// POST /api/admin/telegram
adminRouter.post('/telegram', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SaveTelegramSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid Telegram settings payload' }, 400);
  }

  saveTelegramSettings({
    is_enabled: Boolean(parsed.data.is_enabled),
    bot_token: parsed.data.bot_token,
    chat_id: parsed.data.chat_id,
    notify_on_budget_warning: parsed.data.notify_on_budget_warning !== undefined ? Boolean(parsed.data.notify_on_budget_warning) : true,
    notify_on_budget_exceeded: parsed.data.notify_on_budget_exceeded !== undefined ? Boolean(parsed.data.notify_on_budget_exceeded) : true,
    notify_on_key_cooldown: parsed.data.notify_on_key_cooldown !== undefined ? Boolean(parsed.data.notify_on_key_cooldown) : true,
    notify_on_key_error: parsed.data.notify_on_key_error !== undefined ? Boolean(parsed.data.notify_on_key_error) : true,
  });

  const updated = getTelegramConfig();
  return c.json({
    success: true,
    settings: {
      is_enabled: updated.isEnabled,
      has_bot_token: Boolean(updated.botToken),
      chat_id: updated.chatId || '',
      notify_on_budget_warning: updated.notifyOnBudgetWarning,
      notify_on_budget_exceeded: updated.notifyOnBudgetExceeded,
      notify_on_key_cooldown: updated.notifyOnKeyCooldown,
      notify_on_key_error: updated.notifyOnKeyError,
    },
  });
});

// POST /api/admin/telegram/test
adminRouter.post('/telegram/test', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = TestTelegramSchema.safeParse(body);
  const botToken = parsed.success ? (parsed.data.bot_token || undefined) : undefined;
  const chatId = parsed.success ? (parsed.data.chat_id || undefined) : undefined;

  const result = await testTelegramWebhook(botToken, chatId);
  if (!result.success) {
    return c.json({ error: result.message }, 400);
  }
  return c.json({ success: true, message: result.message });
});

// ==========================================
// 8. SYSTEM & SETTINGS
// ==========================================

// GET /api/admin/system/info
adminRouter.get('/system/info', (c) => {
  const db = getDatabase();
  const dbPath = process.env.CAPY_DB_PATH || process.env.DATABASE_URL || './data/capyllm.db';
  let sizeBytes = 0;
  try {
    const f = Bun.file(dbPath);
    sizeBytes = f.size;
  } catch {}

  const totalLogs = (db.query('SELECT COUNT(*) as count FROM request_logs').get() as any)?.count || 0;
  const totalKeys = (db.query('SELECT COUNT(*) as count FROM virtual_keys').get() as any)?.count || 0;
  const totalUpstream = (db.query('SELECT COUNT(*) as count FROM upstream_keys').get() as any)?.count || 0;
  const totalPricing = (db.query('SELECT COUNT(*) as count FROM model_pricing').get() as any)?.count || 0;

  return c.json({
    version: '1.0.0',
    bun_version: Bun.version,
    uptime_seconds: Math.floor(process.uptime()),
    database_path: dbPath,
    database_size_bytes: sizeBytes,
    total_logs: totalLogs,
    total_virtual_keys: totalKeys,
    total_upstream_keys: totalUpstream,
    total_pricing_rules: totalPricing,
    daily_reset_hour: getDailyResetHour(),
    server_time: new Date().toISOString(),
    server_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
});

// GET /api/admin/system/settings
adminRouter.get('/system/settings', (c) => {
  const now = new Date();
  const resetHour = getDailyResetHour();
  return c.json({
    daily_reset_hour: resetHour,
    server_time: now.toISOString(),
    server_time_formatted: now.toLocaleTimeString([], { hour12: false }),
    server_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    server_timezone_offset: -now.getTimezoneOffset() / 60,
  });
});

// POST /api/admin/system/settings
adminRouter.post('/system/settings', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateSystemSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: sanitizeErrorMessage(parsed.error.issues[0]?.message || 'Invalid settings payload') }, 400);
  }

  setSystemSetting('daily_reset_hour', String(parsed.data.daily_reset_hour));
  return c.json({ success: true, daily_reset_hour: parsed.data.daily_reset_hour });
});

// GET /api/admin/system/backup
adminRouter.get('/system/backup', async (c) => {
  const db = getDatabase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const tempBackupPath = `/tmp/capyllm-backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;

  try {
    db.run(`VACUUM INTO '${tempBackupPath.replace(/'/g, "''")}';`);
    const file = Bun.file(tempBackupPath);
    const buffer = await file.arrayBuffer();
    try {
      const fs = await import('fs/promises');
      await fs.unlink(tempBackupPath);
    } catch {}

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="capyllm-backup-${dateStr}.db"`,
      },
    });
  } catch {
    // Fallback if VACUUM INTO is not supported in the environment
    try {
      db.run('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {}

    const dbPath = process.env.CAPY_DB_PATH || process.env.DATABASE_URL || './data/capyllm.db';
    const file = Bun.file(dbPath);
    if (!(await file.exists())) {
      return c.json({ error: 'Database file not found' }, 404);
    }

    return new Response(file, {
      headers: {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="capyllm-backup-${dateStr}.db"`,
      },
    });
  }
});

// POST /api/admin/system/clear-logs
adminRouter.post('/system/clear-logs', async (c) => {
  const db = getDatabase();
  const body = await c.req.json().catch(() => ({}));
  const days = typeof body.days === 'number' ? body.days : 0;

  if (days < 0) {
    return c.json({ error: 'Days parameter cannot be negative' }, 400);
  }

  if (days > 0) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const res = db.query('DELETE FROM request_logs WHERE created_at < ?').run(cutoff);
    return c.json({ success: true, deleted: res.changes });
  } else {
    const res = db.query('DELETE FROM request_logs').run();
    return c.json({ success: true, deleted: res.changes });
  }
});
