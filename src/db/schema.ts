import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  role: text('role').notNull().default('user'),
  created_at: integer('created_at').notNull(),
});

export const passkeyCredentials = sqliteTable('passkey_credentials', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  public_key: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  device_type: text('device_type'),
  backed_up: integer('backed_up').notNull().default(0),
  transports: text('transports'),
  created_at: integer('created_at').notNull(),
}, (table) => [
  index('idx_passkey_credentials_user_id').on(table.user_id),
]);

export const userInvites = sqliteTable('user_invites', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role').notNull().default('user'),
  token: text('token').unique().notNull(),
  expires_at: integer('expires_at').notNull(),
  used_at: integer('used_at'),
  created_at: integer('created_at').notNull(),
}, (table) => [
  index('idx_user_invites_token').on(table.token),
]);

export const pools = sqliteTable('pools', {
  id: text('id').primaryKey(),
  name: text('name').unique().notNull(),
  description: text('description'),
  budget_type: text('budget_type').notNull().default('tokens'),
  budget_cadence: text('budget_cadence').notNull().default('daily'),
  budget_limit: real('budget_limit').default(0),
  current_spend_tokens: integer('current_spend_tokens').notNull().default(0),
  current_spend_usd: real('current_spend_usd').notNull().default(0),
  spend_reset_at: integer('spend_reset_at').notNull().default(0),
  allow_cross_model_fallback: integer('allow_cross_model_fallback').notNull().default(0),
  reasoning_policy: text('reasoning_policy').notNull().default('inherit'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const upstreamKeys = sqliteTable('upstream_keys', {
  id: text('id').primaryKey(),
  pool_id: text('pool_id'),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  base_url: text('base_url').notNull(),
  encrypted_key: text('encrypted_key').notNull(),
  is_active: integer('is_active').notNull().default(1),
  is_free_tier: integer('is_free_tier').notNull().default(0),
  cooldown_until: integer('cooldown_until').default(0),
  fail_count: integer('fail_count').notNull().default(0),
  last_error: text('last_error'),
  discovered_models: text('discovered_models'),
  daily_token_limit: integer('daily_token_limit').notNull().default(0),
  current_daily_tokens: integer('current_daily_tokens').notNull().default(0),
  daily_tokens_reset_at: integer('daily_tokens_reset_at').notNull().default(0),
  budget_type: text('budget_type').notNull().default('tokens'),
  budget_cadence: text('budget_cadence').notNull().default('daily'),
  budget_limit: real('budget_limit').default(0),
  current_spend_tokens: integer('current_spend_tokens').notNull().default(0),
  current_spend_usd: real('current_spend_usd').notNull().default(0),
  spend_reset_at: integer('spend_reset_at').notNull().default(0),
  api_schema: text('api_schema').notNull().default('chat_completions'),
  supported_schemas: text('supported_schemas').notNull().default('["chat_completions","responses","embeddings","decision"]'),
  custom_schema_config: text('custom_schema_config'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => [
  index('idx_upstream_keys_pool').on(table.pool_id),
]);

export const poolRoutes = sqliteTable('pool_routes', {
  id: text('id').primaryKey(),
  pool_id: text('pool_id').notNull().references(() => pools.id, { onDelete: 'cascade' }),
  upstream_key_id: text('upstream_key_id').notNull().references(() => upstreamKeys.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  model_pattern: text('model_pattern').notNull().default('*'),
  token_limit: integer('token_limit').notNull().default(0),
  current_tokens: integer('current_tokens').notNull().default(0),
  cost_limit: real('cost_limit').notNull().default(0),
  current_cost: real('current_cost').notNull().default(0),
  reasoning_effort: text('reasoning_effort'),
  created_at: integer('created_at').notNull(),
}, (table) => [
  index('idx_pool_routes_pool').on(table.pool_id),
  index('idx_pool_routes_pool_priority').on(table.pool_id, table.priority),
  index('idx_pool_routes_key').on(table.upstream_key_id),
]);

export const virtualKeys = sqliteTable('virtual_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  key_hash: text('key_hash').unique().notNull(),
  key_prefix: text('key_prefix').notNull(),
  pool_id: text('pool_id').references(() => pools.id, { onDelete: 'set null' }),
  rate_limit_rpm: integer('rate_limit_rpm').default(0),
  budget_type: text('budget_type').notNull().default('usd'),
  budget_cadence: text('budget_cadence').notNull().default('monthly'),
  budget_limit: real('budget_limit').default(0),
  budget_monthly_usd: real('budget_monthly_usd').default(0),
  current_spend_usd: real('current_spend_usd').notNull().default(0),
  current_spend_tokens: integer('current_spend_tokens').notNull().default(0),
  spend_reset_at: integer('spend_reset_at').notNull().default(0),
  allowed_pools: text('allowed_pools'),
  allowed_models: text('allowed_models'),
  include_metadata: integer('include_metadata').notNull().default(1),
  is_active: integer('is_active').notNull().default(1),
  last_budget_warning_at: integer('last_budget_warning_at').notNull().default(0),
  last_budget_exceeded_at: integer('last_budget_exceeded_at').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => [
  index('idx_virtual_keys_hash').on(table.key_hash),
  index('idx_virtual_keys_pool').on(table.pool_id),
]);

export const requestLogs = sqliteTable('request_logs', {
  id: text('id').primaryKey(),
  virtual_key_id: text('virtual_key_id').references(() => virtualKeys.id, { onDelete: 'set null' }),
  upstream_key_id: text('upstream_key_id').references(() => upstreamKeys.id, { onDelete: 'set null' }),
  pool_id: text('pool_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  prompt_tokens: integer('prompt_tokens').notNull().default(0),
  completion_tokens: integer('completion_tokens').notNull().default(0),
  total_tokens: integer('total_tokens').notNull().default(0),
  cost_usd: real('cost_usd').notNull().default(0),
  latency_ms: integer('latency_ms').notNull().default(0),
  ttft_ms: integer('ttft_ms'),
  status_code: integer('status_code').notNull().default(200),
  error_message: text('error_message'),
  streamed: integer('streamed').notNull().default(0),
  aborted: integer('aborted').notNull().default(0),
  endpoint: text('endpoint').notNull(),
  adaptation_meta: text('adaptation_meta'),
  created_at: integer('created_at').notNull(),
}, (table) => [
  index('idx_request_logs_created_at').on(table.created_at),
  index('idx_request_logs_virtual_key').on(table.virtual_key_id),
  index('idx_request_logs_upstream_key').on(table.upstream_key_id),
  index('idx_request_logs_pool').on(table.pool_id),
  index('idx_request_logs_model').on(table.model),
  index('idx_request_logs_provider').on(table.provider),
]);

export const modelPricing = sqliteTable('model_pricing', {
  id: text('id').primaryKey(),
  model: text('model').notNull(),
  provider: text('provider'),
  upstream_key_id: text('upstream_key_id').references(() => upstreamKeys.id, { onDelete: 'cascade' }),
  capy_key_id: text('capy_key_id').references(() => virtualKeys.id, { onDelete: 'cascade' }),
  prompt_price_per_1m: real('prompt_price_per_1m').notNull().default(0),
  completion_price_per_1m: real('completion_price_per_1m').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => [
  index('idx_model_pricing_model').on(table.model),
  index('idx_model_pricing_provider').on(table.provider),
  index('idx_model_pricing_upstream_key').on(table.upstream_key_id),
  index('idx_model_pricing_capy_key').on(table.capy_key_id),
]);

export const telegramSettings = sqliteTable('telegram_settings', {
  id: text('id').primaryKey(),
  is_enabled: integer('is_enabled').notNull().default(0),
  bot_token_encrypted: text('bot_token_encrypted'),
  chat_id: text('chat_id'),
  notify_on_budget_warning: integer('notify_on_budget_warning').notNull().default(1),
  notify_on_budget_exceeded: integer('notify_on_budget_exceeded').notNull().default(1),
  notify_on_key_cooldown: integer('notify_on_key_cooldown').notNull().default(1),
  notify_on_key_error: integer('notify_on_key_error').notNull().default(1),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: integer('updated_at').notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  passkeyCredentials: many(passkeyCredentials),
}));

export const passkeyCredentialsRelations = relations(passkeyCredentials, ({ one }) => ({
  user: one(users, {
    fields: [passkeyCredentials.user_id],
    references: [users.id],
  }),
}));

export const poolsRelations = relations(pools, ({ many }) => ({
  routes: many(poolRoutes),
  virtualKeys: many(virtualKeys),
}));

export const upstreamKeysRelations = relations(upstreamKeys, ({ many }) => ({
  routes: many(poolRoutes),
  pricing: many(modelPricing),
  logs: many(requestLogs),
}));

export const poolRoutesRelations = relations(poolRoutes, ({ one }) => ({
  pool: one(pools, {
    fields: [poolRoutes.pool_id],
    references: [pools.id],
  }),
  upstreamKey: one(upstreamKeys, {
    fields: [poolRoutes.upstream_key_id],
    references: [upstreamKeys.id],
  }),
}));

export const virtualKeysRelations = relations(virtualKeys, ({ one, many }) => ({
  pool: one(pools, {
    fields: [virtualKeys.pool_id],
    references: [pools.id],
  }),
  logs: many(requestLogs),
  pricing: many(modelPricing),
}));

export const requestLogsRelations = relations(requestLogs, ({ one }) => ({
  virtualKey: one(virtualKeys, {
    fields: [requestLogs.virtual_key_id],
    references: [virtualKeys.id],
  }),
  upstreamKey: one(upstreamKeys, {
    fields: [requestLogs.upstream_key_id],
    references: [upstreamKeys.id],
  }),
}));

export const modelPricingRelations = relations(modelPricing, ({ one }) => ({
  upstreamKey: one(upstreamKeys, {
    fields: [modelPricing.upstream_key_id],
    references: [upstreamKeys.id],
  }),
  virtualKey: one(virtualKeys, {
    fields: [modelPricing.capy_key_id],
    references: [virtualKeys.id],
  }),
}));
