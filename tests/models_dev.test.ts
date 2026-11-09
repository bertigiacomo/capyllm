import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getModelsDevCatalog,
  getEnrichedModelMetadata,
  normalizeProviderForModelsDev,
  getProviderLogoUrl,
} from '../src/services/models_dev';

describe('models.dev API Integration & Enriched Metadata', () => {
  it('normalizes provider aliases correctly', () => {
    expect(normalizeProviderForModelsDev('gemini')).toBe('google');
    expect(normalizeProviderForModelsDev('google')).toBe('google');
    expect(normalizeProviderForModelsDev('claude')).toBe('anthropic');
    expect(normalizeProviderForModelsDev('anthropic')).toBe('anthropic');
    expect(normalizeProviderForModelsDev('openai')).toBe('openai');
    expect(normalizeProviderForModelsDev('openrouter')).toBe('openrouter');
  });

  it('generates valid vector SVG logo URLs from models.dev', () => {
    expect(getProviderLogoUrl('openai')).toBe('https://models.dev/logos/openai.svg');
    expect(getProviderLogoUrl('anthropic')).toBe('https://models.dev/logos/anthropic.svg');
    expect(getProviderLogoUrl('google')).toBe('https://models.dev/logos/google.svg');
  });

  it('retrieves live or offline fallback catalog from models.dev', async () => {
    const catalog = await getModelsDevCatalog();
    expect(catalog).toBeDefined();
    expect(typeof catalog).toBe('object');
    // Common providers must exist in catalog
    expect(catalog.openai || catalog.anthropic || catalog.google).toBeDefined();
  });

  it('extracts real costs, modalities, limits, and reasoning capability for canonical models', async () => {
    const meta = await getEnrichedModelMetadata('openai', 'gpt-4o');
    expect(meta).toBeDefined();
    if (meta) {
      expect(meta.name).toBe('GPT-4o');
      expect(meta.modalities.input).toContain('text');
      expect(meta.modalities.output).toContain('text');
      expect(meta.limit.context).toBeGreaterThanOrEqual(128000);
      expect(meta.cost.input).toBe(2.5); // $2.50 per 1M tokens
      expect(meta.cost.output).toBe(10); // $10.00 per 1M tokens
      expect(meta.providerLogoUrl).toBe('https://models.dev/logos/openai.svg');
    }
  });

  it('detects reasoning capability for reasoning models like o1 or o3-mini', async () => {
    const o3 = await getEnrichedModelMetadata('openai', 'o3-mini');
    if (o3) {
      expect(o3.reasoning).toBe(true);
      expect(o3.cost.input).toBeDefined();
      expect(o3.cost.output).toBeDefined();
    }
  });
});
