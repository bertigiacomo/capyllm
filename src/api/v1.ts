import { Hono, type Context } from 'hono';
import { requireVirtualKey } from './auth_vk';
import { handleOpenAiRelay } from '../engine/openai_relay';
import { handleJevRelay } from '../engine/jev_relay';
import { getDatabase, type UpstreamKey, type VirtualKey } from '../db';

export const v1Router = new Hono();

// All /v1 endpoints require a valid Virtual Key
v1Router.use('*', requireVirtualKey);

function resolvePools(c: Context, vk: VirtualKey): { poolIds: string[]; primaryPool: string; error?: string } {
  if (vk.pool_id) {
    return { poolIds: [vk.pool_id], primaryPool: vk.pool_id };
  }
  if (vk.allowed_pools) {
    try {
      const allowed = JSON.parse(vk.allowed_pools);
      if (Array.isArray(allowed) && allowed.length > 0 && allowed[0] !== '*') {
        return { poolIds: allowed, primaryPool: allowed[0] };
      }
    } catch {}
  }
  const db = getDatabase();
  const firstPool = db.query('SELECT id FROM pools ORDER BY created_at ASC LIMIT 1').get() as { id: string } | null;
  if (firstPool) {
    return { poolIds: [firstPool.id], primaryPool: firstPool.id };
  }
  const keyWithPool = db.query("SELECT pool_id FROM upstream_keys WHERE pool_id IS NOT NULL AND pool_id != '' LIMIT 1").get() as { pool_id: string } | null;
  if (keyWithPool && keyWithPool.pool_id) {
    return { poolIds: [keyWithPool.pool_id], primaryPool: keyWithPool.pool_id };
  }
  return { poolIds: ['default'], primaryPool: 'default' };
}

const DEFAULT_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'o1',
  'o3-mini',
  'claude-3-5-sonnet',
  'gemini-1.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'deepseek-chat',
  'deepseek-reasoner',
  'llama-3.3-70b-versatile',
  'mistral-large-latest',
];

function getAvailableModelsForClient(vk: VirtualKey): string[] {
  // If key specifically restricts models, return allowed models
  if (vk.allowed_models) {
    try {
      const parsed = JSON.parse(vk.allowed_models);
      if (Array.isArray(parsed) && parsed.length > 0 && !parsed.includes('*')) {
        return parsed;
      }
    } catch {}
  }

  // Otherwise, aggregate all models discovered across active upstream keys
  try {
    const db = getDatabase();
    const rows = db.query(
      'SELECT discovered_models FROM upstream_keys WHERE is_active = 1 AND discovered_models IS NOT NULL'
    ).all() as { discovered_models: string }[];

    const modelsSet = new Set<string>();
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.discovered_models);
        if (Array.isArray(parsed)) {
          parsed.forEach((m) => modelsSet.add(String(m)));
        }
      } catch {}
    }

    if (modelsSet.size > 0) {
      return Array.from(modelsSet).sort();
    }
  } catch {}

  return DEFAULT_MODELS;
}

// GET /v1/models
v1Router.get('/models', (c) => {
  const vk = c.get('virtualKey');
  const allowedList = getAvailableModelsForClient(vk);

  const modelEntries = allowedList.map((modelId) => ({
    id: modelId,
    object: 'model',
    created: 1700000000,
    owned_by: 'capyllm',
  }));

  return c.json({
    object: 'list',
    data: modelEntries,
  });
});

// GET /v1/models/:model
v1Router.get('/models/:model', (c) => {
  const modelId = c.req.param('model');
  const vk = c.get('virtualKey');
  const allowedList = getAvailableModelsForClient(vk);

  if (!allowedList.includes(modelId) && !allowedList.includes('*')) {
    return c.json(
      {
        error: {
          message: `The model '${modelId}' does not exist or is not available to this API key`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      },
      404
    );
  }

  return c.json({
    id: modelId,
    object: 'model',
    created: 1700000000,
    owned_by: 'capyllm',
  });
});

// POST /v1/chat/completions
v1Router.post('/chat/completions', async (c) => {
  const vk = c.get('virtualKey');
  const { poolIds, primaryPool, error } = resolvePools(c, vk);
  if (error) {
    return c.json({ error: { message: error, type: 'permission_error' } }, 403);
  }

  return await handleOpenAiRelay(c, {
    poolId: primaryPool,
    poolIds,
    virtualKey: vk,
    endpoint: '/chat/completions',
  });
});

// POST /v1/responses (OpenAI Responses API)
v1Router.post('/responses', async (c) => {
  const vk = c.get('virtualKey');
  const { poolIds, primaryPool, error } = resolvePools(c, vk);
  if (error) {
    return c.json({ error: { message: error, type: 'permission_error' } }, 403);
  }

  return await handleOpenAiRelay(c, {
    poolId: primaryPool,
    poolIds,
    virtualKey: vk,
    endpoint: '/responses',
  });
});

// POST /v1/embeddings
v1Router.post('/embeddings', async (c) => {
  const vk = c.get('virtualKey');
  const { poolIds, primaryPool, error } = resolvePools(c, vk);
  if (error) {
    return c.json({ error: { message: error, type: 'permission_error' } }, 403);
  }

  return await handleOpenAiRelay(c, {
    poolId: primaryPool,
    poolIds,
    virtualKey: vk,
    endpoint: '/embeddings',
  });
});

// POST /v1/systemone
v1Router.post('/systemone', async (c) => {
  const vk = c.get('virtualKey');
  const { primaryPool, error } = resolvePools(c, vk);
  if (error) {
    return c.json({ error: { message: error, type: 'permission_error' } }, 403);
  }

  return await handleJevRelay(c, {
    poolId: primaryPool,
    virtualKey: vk,
    endpoint: '/systemone',
  });
});

// POST /v1/decisions
v1Router.post('/decisions', async (c) => {
  const vk = c.get('virtualKey');
  const { primaryPool, error } = resolvePools(c, vk);
  if (error) {
    return c.json({ error: { message: error, type: 'permission_error' } }, 403);
  }

  return await handleJevRelay(c, {
    poolId: primaryPool,
    virtualKey: vk,
    endpoint: '/decisions',
  });
});
