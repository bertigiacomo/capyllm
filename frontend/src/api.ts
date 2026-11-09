export interface UserSession {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

export async function fetchMe(): Promise<{ authenticated: boolean; user: UserSession | null }> {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return { authenticated: false, user: null };
    return await res.json();
  } catch {
    return { authenticated: false, user: null };
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function getSetupOptions(token: string) {
  const res = await fetch('/api/auth/setup/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch setup options');
  }
  return await res.json();
}

export async function verifySetup(token: string, response: any) {
  const res = await fetch('/api/auth/setup/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, response }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Verification failed');
  }
  return await res.json();
}

export async function getLoginOptions() {
  const res = await fetch('/api/auth/login/options', {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch login options');
  }
  return await res.json();
}

export async function verifyLogin(response: any) {
  const res = await fetch('/api/auth/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Passkey login failed');
  }
  return await res.json();
}

export interface AppUsageStat {
  app_name: string;
  app_id: string;
  requests: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  percentage: number;
}

export interface ModelUsageStat {
  model: string;
  provider: string;
  requests: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  avg_latency_ms: number;
  avg_ttft_ms: number;
  percentage: number;
}

export interface ProviderReliabilityStat {
  provider: string;
  provider_logo_url?: string;
  total_requests: number;
  success_requests: number;
  success_rate_pct: number;
  rate_limit_429_count: number;
  error_count: number;
  avg_latency_ms: number;
  avg_ttft_ms: number;
  total_tokens: number;
  completion_tokens: number;
  tokens_per_sec: number;
}

export interface DashboardStats {
  total_requests: number;
  total_tokens: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_spend_usd: number;
  avg_latency_ms: number;
  avg_ttft_ms: number;
  error_rate_pct: number;
  total_keys: number;
  active_keys: number;
  cooling_down_keys: number;
  today: {
    requests: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  };
  quota: {
    daily_token_limit: number;
    current_daily_tokens: number;
  };
  hourly_activity?: Array<{
    hour: string;
    label: string;
    requests: number;
    tokens: number;
    cost_usd: number;
  }>;
  by_app: AppUsageStat[];
  by_model: ModelUsageStat[];
  provider_reliability?: ProviderReliabilityStat[];
}

export async function getAdminStats(): Promise<DashboardStats> {
  const res = await fetch('/api/admin/stats');
  if (!res.ok) throw new Error('Failed to load stats');
  return await res.json();
}

export interface ModelDetailStats {
  model: string;
  total_requests: number;
  total_tokens: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_spend_usd: number;
  avg_latency_ms: number;
  avg_ttft_ms: number;
  error_count: number;
  success_rate_pct: number;
  by_provider: Array<{
    provider: string;
    requests: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    avg_latency_ms: number;
    avg_ttft_ms: number;
    tokens_per_sec?: number;
    error_count: number;
    share_pct: number;
  }>;
  by_app: Array<{
    app_id: string;
    app_name: string;
    requests: number;
    total_tokens: number;
    cost_usd: number;
    share_pct: number;
  }>;
}

export async function getModelStats(model: string): Promise<ModelDetailStats> {
  const res = await fetch(`/api/admin/stats/model/${encodeURIComponent(model)}`);
  if (!res.ok) throw new Error('Failed to load model stats');
  return await res.json();
}

export async function getUpstreamKeys() {
  const res = await fetch('/api/admin/keys');
  if (!res.ok) throw new Error('Failed to load upstream keys');
  return await res.json();
}

export async function createUpstreamKey(data: {
  provider: string;
  name: string;
  base_url: string;
  api_key: string;
  pool_id?: string;
  is_free_tier?: boolean;
  daily_token_limit?: number;
  budget_type?: 'usd' | 'tokens';
  budget_cadence?: 'daily' | 'weekly' | 'monthly' | 'one-shot';
  budget_limit?: number;
  api_schema?: 'chat_completions' | 'responses' | 'decision' | 'custom';
  supported_schemas?: string[];
  custom_schema_config?: string;
}) {
  const res = await fetch('/api/admin/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create key');
  }
  return await res.json();
}

export async function updateUpstreamKey(
  id: string,
  data: {
    name?: string;
    provider?: string;
    base_url?: string;
    api_key?: string;
    pool_id?: string;
    is_active?: boolean;
    is_free_tier?: boolean;
    daily_token_limit?: number;
    budget_type?: 'usd' | 'tokens';
    budget_cadence?: 'daily' | 'weekly' | 'monthly' | 'one-shot';
    budget_limit?: number;
    api_schema?: 'chat_completions' | 'responses' | 'decision' | 'custom';
    supported_schemas?: string[];
    custom_schema_config?: string;
  }
) {
  const res = await fetch(`/api/admin/keys/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update key');
  }
  return await res.json();
}

export async function resetUpstreamKeyTokens(id: string) {
  const res = await fetch(`/api/admin/keys/${id}/reset-tokens`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reset daily tokens');
  return await res.json();
}

export interface SystemInfo {
  version: string;
  bun_version: string;
  uptime_seconds: number;
  database_path: string;
  database_size_bytes: number;
  total_logs: number;
  total_virtual_keys: number;
  total_upstream_keys: number;
  total_pricing_rules: number;
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const res = await fetch('/api/admin/system/info');
  if (!res.ok) throw new Error('Failed to load system info');
  return await res.json();
}

export async function clearLogs(days = 0): Promise<{ success: boolean; deleted: number }> {
  const res = await fetch('/api/admin/system/clear-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  if (!res.ok) throw new Error('Failed to clear logs');
  return await res.json();
}

export async function deleteUpstreamKey(id: string) {
  const res = await fetch(`/api/admin/keys/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete key');
  return await res.json();
}

export async function resetKeyCooldown(id: string) {
  const res = await fetch(`/api/admin/keys/${id}/reset-cooldown`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reset cooldown');
  return await res.json();
}

export async function testUpstreamKey(id: string) {
  const res = await fetch(`/api/admin/keys/${id}/test`, { method: 'POST' });
  return await res.json();
}

export async function discoverUpstreamModels(id: string) {
  const res = await fetch(`/api/admin/keys/${id}/discover-models`, { method: 'POST' });
  return await res.json();
}

export async function getProviderPresets() {
  const res = await fetch('/api/admin/provider-presets');
  if (!res.ok) throw new Error('Failed to load provider presets');
  return await res.json();
}

export async function getDiscoveredModels() {
  const res = await fetch('/api/admin/discovered-models');
  if (!res.ok) throw new Error('Failed to load discovered models');
  return await res.json();
}

export async function getPools() {
  const res = await fetch('/api/admin/pools');
  if (!res.ok) throw new Error('Failed to load pools');
  return await res.json();
}

export async function createPool(data: {
  id: string;
  name: string;
  description?: string;
  budget_type?: 'tokens' | 'usd';
  budget_cadence?: 'daily' | 'weekly' | 'monthly' | 'one-shot';
  budget_limit?: number;
  allow_cross_model_fallback?: number;
  reasoning_policy?: string;
}) {
  const res = await fetch('/api/admin/pools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create pool');
  }
  return await res.json();
}

export async function updatePool(
  id: string,
  data: {
    name?: string;
    description?: string;
    budget_type?: 'tokens' | 'usd';
    budget_cadence?: 'daily' | 'weekly' | 'monthly' | 'one-shot';
    budget_limit?: number;
    allow_cross_model_fallback?: number;
    reasoning_policy?: string;
  }
) {
  const res = await fetch(`/api/admin/pools/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update pool');
  }
  return await res.json();
}

export async function setPoolRoutes(
  poolId: string,
  routes: Array<{
    id?: string;
    upstream_key_id: string;
    priority: number;
    model_pattern?: string;
    token_limit?: number;
    cost_limit?: number;
    reasoning_effort?: string | null;
  }>
) {
  const res = await fetch(`/api/admin/pools/${poolId}/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update pool routes');
  }
  return await res.json();
}

export async function resetRouteSpend(poolId: string, routeId: string) {
  const res = await fetch(`/api/admin/pools/${poolId}/routes/${routeId}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reset route spend');
  return await res.json();
}

export async function deletePool(id: string) {
  const res = await fetch(`/api/admin/pools/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete pool');
  return await res.json();
}

export async function getVirtualKeys() {
  const res = await fetch('/api/admin/virtual-keys');
  if (!res.ok) throw new Error('Failed to load virtual keys');
  return await res.json();
}

export async function createVirtualKey(data: {
  name: string;
  pool_id?: string;
  rate_limit_rpm?: number;
  budget_type?: 'usd' | 'tokens';
  budget_cadence?: 'daily' | 'weekly' | 'monthly' | 'one-shot';
  budget_limit?: number;
  budget_monthly_usd?: number;
  allowed_pools?: string[];
  allowed_models?: string[];
  include_metadata?: boolean | number;
}) {
  const res = await fetch('/api/admin/virtual-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create virtual key');
  }
  return await res.json();
}

export interface EnrichedCatalogModel {
  model: string;
  metadata?: {
    name: string;
    description?: string;
    modalities?: { input: string[]; output: string[] };
    limit?: { context?: number; output?: number };
    reasoning?: boolean;
    toolCall?: boolean;
    attachment?: boolean;
    temperature?: boolean;
  };
  providers_count: number;
  providers: Array<{
    key_id: string;
    key_name: string;
    provider: string;
    provider_logo_url?: string;
    is_free_tier: boolean;
    prompt_price_per_1m: number;
    completion_price_per_1m: number;
    pricing_rule_id?: string;
  }>;
}

export async function getModelsCatalog(): Promise<{
  catalog: EnrichedCatalogModel[];
}> {
  const res = await fetch('/api/admin/models-catalog');
  if (!res.ok) throw new Error('Failed to load models catalog');
  return await res.json();
}

export async function syncModelsDev(): Promise<{
  success: boolean;
  providers_count: number;
  models_count: number;
  refreshed_at: string;
}> {
  const res = await fetch('/api/admin/models-dev/sync', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to sync models.dev catalog');
  }
  return await res.json();
}

export async function updateVirtualKey(
  id: string,
  data: {
    name?: string;
    pool_id?: string;
    rate_limit_rpm?: number;
    budget_type?: 'usd' | 'tokens';
    budget_cadence?: 'daily' | 'weekly' | 'monthly' | 'one-shot';
    budget_limit?: number;
    budget_monthly_usd?: number;
    is_active?: boolean;
    allowed_pools?: string[];
    allowed_models?: string[];
    include_metadata?: boolean | number;
  }
) {
  const res = await fetch(`/api/admin/virtual-keys/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update virtual key');
  }
  return await res.json();
}

export async function deleteVirtualKey(id: string) {
  const res = await fetch(`/api/admin/virtual-keys/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete virtual key');
  return await res.json();
}

export async function resetVirtualKeySpend(id: string) {
  const res = await fetch(`/api/admin/virtual-keys/${id}/reset-spend`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reset spend');
  return await res.json();
}

// CapyKey terminology aliases
export const getCapyKeys = getVirtualKeys;
export const createCapyKey = createVirtualKey;
export const updateCapyKey = updateVirtualKey;
export const deleteCapyKey = deleteVirtualKey;
export const resetCapyKeySpend = resetVirtualKeySpend;

export async function getLogs(limit = 50, offset = 0, model?: string, provider?: string) {
  const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
  if (model) params.set('model', model);
  if (provider) params.set('provider', provider);
  const res = await fetch(`/api/admin/logs?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load logs');
  return await res.json();
}

export interface PricingRule {
  id: string;
  model: string;
  provider: string | null;
  upstream_key_id: string | null;
  capy_key_id: string | null;
  prompt_price_per_1m: number;
  completion_price_per_1m: number;
  created_at: number;
  updated_at: number;
  upstream_key_name?: string | null;
  upstream_key_provider?: string | null;
  capy_key_name?: string | null;
}

export async function getPricingRules(): Promise<{ rules: PricingRule[] }> {
  const res = await fetch('/api/admin/pricing');
  if (!res.ok) throw new Error('Failed to load pricing rules');
  return await res.json();
}

export async function createPricingRule(data: {
  model: string;
  provider?: string | null;
  upstream_key_id?: string | null;
  capy_key_id?: string | null;
  prompt_price_per_1m: number;
  completion_price_per_1m: number;
}): Promise<{ success: boolean; rule: PricingRule }> {
  const res = await fetch('/api/admin/pricing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create pricing rule');
  }
  return await res.json();
}

export async function updatePricingRule(
  id: string,
  data: Partial<{
    model: string;
    provider: string | null;
    upstream_key_id: string | null;
    capy_key_id: string | null;
    prompt_price_per_1m: number;
    completion_price_per_1m: number;
  }>
): Promise<{ success: boolean }> {
  const res = await fetch(`/api/admin/pricing/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update pricing rule');
  }
  return await res.json();
}

export async function deletePricingRule(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/admin/pricing/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete pricing rule');
  return await res.json();
}

export interface TelegramConfig {
  is_enabled: boolean;
  has_bot_token: boolean;
  chat_id: string;
  notify_on_budget_warning: boolean;
  notify_on_budget_exceeded: boolean;
  notify_on_key_cooldown: boolean;
  notify_on_key_error: boolean;
}

export async function getTelegramSettings(): Promise<TelegramConfig> {
  const res = await fetch('/api/admin/telegram');
  if (!res.ok) throw new Error('Failed to load Telegram settings');
  return await res.json();
}

export async function saveTelegramSettings(data: {
  is_enabled: boolean;
  bot_token?: string | null;
  chat_id: string;
  notify_on_budget_warning?: boolean;
  notify_on_budget_exceeded?: boolean;
  notify_on_key_cooldown?: boolean;
  notify_on_key_error?: boolean;
}): Promise<{ success: boolean; settings: TelegramConfig }> {
  const res = await fetch('/api/admin/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save Telegram settings');
  }
  return await res.json();
}

export async function testTelegramWebhook(data?: {
  bot_token?: string;
  chat_id?: string;
}): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/admin/telegram/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || 'Telegram test failed');
  }
  return json;
}

export async function getProviderStats(provider: string): Promise<{
  provider: string;
  models: Array<{
    model: string;
    requests: number;
    tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    avg_latency_ms: number;
    tokens_per_sec: number;
  }>;
}> {
  const res = await fetch(`/api/admin/stats/provider/${encodeURIComponent(provider)}`);
  if (!res.ok) throw new Error('Failed to load provider statistics');
  return await res.json();
}

export interface SystemSettings {
  daily_reset_hour: number;
  server_time: string;
  server_time_formatted: string;
  server_timezone: string;
  server_timezone_offset: number;
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const res = await fetch('/api/admin/system/settings');
  if (!res.ok) throw new Error('Failed to load system settings');
  return await res.json();
}

export async function updateSystemSettings(data: { daily_reset_hour: number }): Promise<{ success: boolean; daily_reset_hour: number }> {
  const res = await fetch('/api/admin/system/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update system settings');
  }
  return await res.json();
}

