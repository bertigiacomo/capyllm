import fs from 'node:fs';
import path from 'node:path';
import { providers as fallbackSnapshot } from '@opencode-ai/models/snapshot';

export interface ModelsDevModelCost {
  input?: number;
  output?: number;
  cache_read?: number;
}

export interface ModelsDevModelLimit {
  context?: number;
  output?: number;
}

export interface ModelsDevModalities {
  input: string[];
  output: string[];
}

export interface ModelsDevModel {
  id: string;
  name?: string;
  description?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: any[];
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  modalities?: ModelsDevModalities;
  open_weights?: boolean;
  limit?: ModelsDevModelLimit;
  cost?: ModelsDevModelCost;
  canonical_model_id?: string;
}

export interface ModelsDevProvider {
  id: string;
  name?: string;
  api?: string;
  doc?: string;
  models?: Record<string, ModelsDevModel>;
}

export interface EnrichedModelMetadata {
  name: string;
  description?: string;
  family?: string;
  modalities: ModelsDevModalities;
  limit: ModelsDevModelLimit;
  cost: ModelsDevModelCost;
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
  providerLogoUrl: string;
  rawMetadata?: any;
}

const dataDir = process.env.CAPY_DB_PATH
  ? path.dirname(process.env.CAPY_DB_PATH)
  : path.resolve(process.cwd(), 'data');
const CACHE_FILE = path.resolve(dataDir, 'models_dev_cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let inMemoryCatalog: Record<string, ModelsDevProvider> | null = null;
let lastFetchTime = 0;

/**
 * Standardizes provider names to match models.dev conventions
 */
export function normalizeProviderForModelsDev(provider: string): string {
  const p = (provider || '').toLowerCase().trim();
  if (p === 'google-vertex') return 'google-vertex';
  if (p === 'gemini' || p === 'google') return 'google';
  if (p === 'openrouter') return 'openrouter';
  if (p === 'openai') return 'openai';
  if (p === 'anthropic' || p === 'claude') return 'anthropic';
  if (p === 'groq') return 'groq';
  if (p === 'mistral') return 'mistral';
  if (p === 'deepseek') return 'deepseek';
  if (p === 'cohere') return 'cohere';
  if (p === 'together') return 'together';
  if (p === 'perplexity') return 'perplexity';
  return p;
}

/**
 * Returns the SVG logo URL from models.dev for a given provider
 */
export function getProviderLogoUrl(provider: string): string {
  const norm = normalizeProviderForModelsDev(provider);
  return `https://models.dev/logos/${norm}.svg`;
}

/**
 * Loads cached catalog from disk if valid
 */
function loadDiskCache(): Record<string, ModelsDevProvider> | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const stat = fs.statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const content = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {}
  return null;
}

/**
 * Saves catalog to disk cache safely
 */
function saveDiskCache(data: Record<string, ModelsDevProvider>): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
  } catch {}
}

/**
 * Converts snapshot into models.dev provider catalog format as offline fallback
 */
function getSnapshotFallback(): Record<string, ModelsDevProvider> {
  const catalog: Record<string, ModelsDevProvider> = {};
  try {
    for (const [pId, pData] of Object.entries(fallbackSnapshot as any)) {
      const prov = pData as any;
      catalog[pId] = {
        id: prov.id || pId,
        name: prov.name || pId,
        api: prov.api,
        doc: prov.doc,
        models: prov.models || {},
      };
    }
  } catch {}
  return catalog;
}

/**
 * Fetches the live catalog from https://models.dev/api.json?type=all with offline fallback
 */
export async function getModelsDevCatalog(forceRefresh = false): Promise<Record<string, ModelsDevProvider>> {
  const now = Date.now();

  if (!forceRefresh && inMemoryCatalog && (now - lastFetchTime < CACHE_TTL_MS)) {
    return inMemoryCatalog;
  }

  // Check disk cache if not forced
  if (!forceRefresh) {
    const disk = loadDiskCache();
    if (disk) {
      inMemoryCatalog = disk;
      lastFetchTime = now;
      return disk;
    }
  }

  try {
    // Attempt live network fetch with 5-second timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://models.dev/api.json?type=all', {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'CapyLLM/1.0 (models.dev sync)',
      },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as Record<string, ModelsDevProvider>;
      if (data && typeof data === 'object') {
        inMemoryCatalog = data;
        lastFetchTime = now;
        saveDiskCache(data);
        return data;
      }
    }
  } catch (err) {
    // Network or timeout error - gracefully fall back
  }

  // Try expired disk cache or offline snapshot
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed) {
        inMemoryCatalog = parsed;
        lastFetchTime = now;
        return parsed;
      }
    } catch {}
  }

  inMemoryCatalog = getSnapshotFallback();
  lastFetchTime = now;
  return inMemoryCatalog;
}

/**
 * Look up enriched metadata for a model from models.dev
 */
export async function getEnrichedModelMetadata(
  provider: string,
  modelId: string
): Promise<EnrichedModelMetadata | null> {
  const catalog = await getModelsDevCatalog();
  const normProvider = normalizeProviderForModelsDev(provider);
  const cleanModel = (modelId || '').trim();
  const lowerModel = cleanModel.toLowerCase();

  const prov = catalog[normProvider];
  let foundModel: ModelsDevModel | undefined = prov?.models?.[cleanModel] || prov?.models?.[lowerModel];

  // If not found in provider specific section, search for model across OpenRouter or canonical lab
  if (!foundModel) {
    // Check openrouter
    if (catalog.openrouter?.models?.[cleanModel]) {
      foundModel = catalog.openrouter.models[cleanModel];
    } else if (catalog.openrouter?.models?.[lowerModel]) {
      foundModel = catalog.openrouter.models[lowerModel];
    }
  }

  // Search case-insensitive or stripped prefixes across all providers
  if (!foundModel) {
    for (const p of Object.values(catalog)) {
      if (!p.models) continue;
      for (const [mKey, mVal] of Object.entries(p.models)) {
        if (mKey.toLowerCase() === lowerModel || mVal.id?.toLowerCase() === lowerModel) {
          foundModel = mVal;
          break;
        }
      }
      if (foundModel) break;
    }
  }

  if (!foundModel) {
    return null;
  }

  const modalities: ModelsDevModalities = {
    input: foundModel.modalities?.input || ['text'],
    output: foundModel.modalities?.output || ['text'],
  };

  const limit: ModelsDevModelLimit = {
    context: foundModel.limit?.context || 128000,
    output: foundModel.limit?.output || 4096,
  };

  const cost: ModelsDevModelCost = {
    input: foundModel.cost?.input !== undefined ? foundModel.cost.input : undefined,
    output: foundModel.cost?.output !== undefined ? foundModel.cost.output : undefined,
    cache_read: foundModel.cost?.cache_read !== undefined ? foundModel.cost.cache_read : undefined,
  };

  return {
    name: foundModel.name || cleanModel,
    description: foundModel.description,
    family: foundModel.family,
    modalities,
    limit,
    cost,
    reasoning: Boolean(foundModel.reasoning),
    reasoning_options: foundModel.reasoning_options,
    toolCall: Boolean(foundModel.tool_call),
    structuredOutput: Boolean(foundModel.structured_output),
    attachment: Boolean(foundModel.attachment),
    temperature: foundModel.temperature !== false,
    openWeights: foundModel.open_weights,
    releaseDate: (foundModel as any).release_date,
    lastUpdated: (foundModel as any).last_updated,
    knowledge: (foundModel as any).knowledge,
    canonicalModelId: foundModel.canonical_model_id,
    sourceProvider: normProvider,
    providerLogoUrl: getProviderLogoUrl(normProvider),
    rawMetadata: foundModel,
  };
}
