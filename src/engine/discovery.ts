import { providers } from '@opencode-ai/models/snapshot';

export interface DiscoveredModelResult {
  success: boolean;
  models: string[];
  latency_ms: number;
  status?: number;
  error?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  description: string;
  defaultModels: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: 'GPT-4o, GPT-4o-mini, o1, o3-mini',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
  },
  {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    description: 'Gemini 2.0 Flash, 1.5 Flash, 1.5 Pro',
    defaultModels: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    description: 'Llama 3.3 70B, Llama 3.1 8B, Mixtral',
    defaultModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    description: 'Mistral Large, Codestral, Mistral Small',
    defaultModels: ['mistral-large-latest', 'codestral-latest', 'mistral-small-latest'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    description: 'DeepSeek Chat (V3), DeepSeek Reasoner (R1)',
    defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: 'Unified router with 100+ multi-provider models',
    defaultModels: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-exp:free'],
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    description: 'Ultra-fast open-source LLM inference',
    defaultModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local / Self-Hosted)',
    baseUrl: 'http://localhost:11434/v1',
    description: 'Local LLMs running on your machine or private cluster',
    defaultModels: ['llama3.2', 'qwen2.5-coder'],
  },
  {
    id: 'jev',
    name: 'TypeSafe Jev/Kev Decisions',
    baseUrl: 'https://api.typesafe.ai/v1',
    description: 'Low-latency System One and fast decision endpoints',
    defaultModels: ['systemone', 'decisions'],
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-Compatible)',
    baseUrl: '',
    description: 'Any standard OpenAI-compatible API gateway',
    defaultModels: [],
  },
];

/**
 * Returns the full catalog of 235 providers known by models.dev,
 * with popular top providers prioritized for autocomplete and rapid setup.
 */
export function getAllModelsDevProviders(): Array<{ id: string; name: string; baseUrl: string; modelsCount: number }> {
  const topIds = [
    'openai', 'inception', 'anthropic', 'google', 'openrouter',
    'deepseek', 'groq', 'mistral', 'together', 'xai',
    'cerebras', 'fireworks-ai', 'cohere', 'ollama', 'custom'
  ];

  const result: Array<{ id: string; name: string; baseUrl: string; modelsCount: number }> = [];
  const seen = new Set<string>();

  for (const id of topIds) {
    if (id === 'custom') {
      result.push({
        id: 'custom',
        name: 'Personalizzato (Custom URL)',
        baseUrl: '',
        modelsCount: 0,
      });
      seen.add('custom');
      continue;
    }
    const p = (providers as any)[id];
    if (p) {
      result.push({
        id: p.id,
        name: p.name || p.id,
        baseUrl: (p.api || '').replace(/\/+$/, ''),
        modelsCount: p.models ? Object.keys(p.models).length : 0,
      });
      seen.add(id);
    }
  }

  const remaining = Object.values(providers)
    .filter((p: any) => p && p.id && !seen.has(p.id))
    .sort((a: any, b: any) => (a.name || a.id).localeCompare(b.name || b.id));

  for (const p of remaining as any[]) {
    result.push({
      id: p.id,
      name: p.name || p.id,
      baseUrl: (p.api || '').replace(/\/+$/, ''),
      modelsCount: p.models ? Object.keys(p.models).length : 0,
    });
  }

  return result;
}

/**
 * Executes a zero-token test request to discover accessible models from an upstream provider.
 * Consumes 0 prompt and 0 completion tokens.
 */
export async function discoverModelsForProvider(
  provider: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs = 6000
): Promise<DiscoveredModelResult> {
  const startTime = Date.now();

  // If provider is Jev / Kev, return predefined models immediately
  if (provider === 'jev') {
    return {
      success: true,
      models: ['systemone', 'decisions'],
      latency_ms: Date.now() - startTime,
      status: 200,
    };
  }

  const cleanBase = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanBase && provider !== 'gemini') {
    return {
      success: false,
      models: [],
      latency_ms: 0,
      error: 'Base URL is required to discover models',
    };
  }

  // Determine candidate URLs
  const urlsToTry: string[] = [];

  if (provider === 'gemini') {
    if (cleanBase) {
      urlsToTry.push(`${cleanBase}/models`);
    }
    // Google AI Studio native endpoint with API key query param
    urlsToTry.push(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  } else {
    urlsToTry.push(`${cleanBase}/models`);
    if (!cleanBase.endsWith('/v1')) {
      urlsToTry.push(`${cleanBase}/v1/models`);
    }
  }

  let lastStatus = 0;
  let lastError = 'Unable to reach provider endpoint';

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'x-goog-api-key': apiKey,
          'Accept': 'application/json',
          'User-Agent': 'CapyLLM/1.0',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      lastStatus = res.status;

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const models = parseModelsResponse(data);
        const latency = Date.now() - startTime;

        return {
          success: true,
          models,
          latency_ms: latency,
          status: res.status,
        };
      } else {
        const errJson = await res.json().catch(() => null);
        lastError =
          errJson?.error?.message ||
          errJson?.message ||
          `Provider responded with HTTP ${res.status}`;
      }
    } catch (err: any) {
      lastError = err.message || 'Connection failed or timed out';
    }
  }

  return {
    success: false,
    models: [],
    latency_ms: Date.now() - startTime,
    status: lastStatus || 500,
    error: lastError,
  };
}

/**
 * Normalizes different provider /models payloads into a clean list of model IDs.
 */
function parseModelsResponse(json: any): string[] {
  if (!json || typeof json !== 'object') {
    return [];
  }

  const modelIds: Set<string> = new Set();

  // 1. OpenAI / Groq / Mistral / DeepSeek / Together standard: { data: [ { id: '...' } ] }
  if (Array.isArray(json.data)) {
    for (const item of json.data) {
      if (typeof item === 'string' && item.trim()) {
        modelIds.add(item.trim());
      } else if (item && typeof item === 'object') {
        const id = item.id || item.name || item.model;
        if (typeof id === 'string' && id.trim()) {
          modelIds.add(id.trim());
        }
      }
    }
  }

  // 2. Google Gemini native: { models: [ { name: "models/gemini-1.5-flash", ... } ] }
  if (Array.isArray(json.models)) {
    for (const item of json.models) {
      if (typeof item === 'string' && item.trim()) {
        modelIds.add(item.replace(/^models\//, '').trim());
      } else if (item && typeof item === 'object') {
        const id = item.name || item.id || item.displayName;
        if (typeof id === 'string' && id.trim()) {
          modelIds.add(id.replace(/^models\//, '').trim());
        }
      }
    }
  }

  // 3. Simple array root: [ "model-a", "model-b" ]
  if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === 'string' && item.trim()) {
        modelIds.add(item.trim());
      } else if (item && typeof item === 'object' && item.id) {
        modelIds.add(String(item.id).trim());
      }
    }
  }

  return Array.from(modelIds).sort((a, b) => a.localeCompare(b));
}
