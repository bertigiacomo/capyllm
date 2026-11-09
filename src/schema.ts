import { z } from 'zod';

export const ProviderEnum = z.enum([
  'openai',
  'gemini',
  'groq',
  'mistral',
  'deepseek',
  'openrouter',
  'together',
  'ollama',
  'jev',
  'custom',
]);

export const ApiSchemaEnum = z.enum([
  'chat_completions',
  'responses',
  'decision',
  'custom',
]);

export const CreateUpstreamKeySchema = z.object({
  provider: z.string().trim().min(1, 'Provider is required'),
  name: z.string().trim().min(1, 'Name is required'),
  base_url: z.string().trim().url('base_url must be a valid URL'),
  api_key: z.string().trim().min(1, 'api_key is required'),
  pool_id: z.string().trim().optional().nullable(),
  is_free_tier: z.union([z.boolean(), z.number()]).optional().default(false),
  daily_token_limit: z.number().int().min(0).optional().default(0),
  budget_type: z.enum(['usd', 'tokens']).optional().default('tokens'),
  budget_cadence: z.enum(['daily', 'weekly', 'monthly', 'one-shot']).optional().default('daily'),
  budget_limit: z.number().nonnegative().optional().default(0),
  api_schema: ApiSchemaEnum.optional().default('chat_completions'),
  supported_schemas: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  custom_schema_config: z.string().trim().optional().nullable(),
});

export const UpdateUpstreamKeySchema = z.object({
  provider: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  base_url: z.string().trim().url().optional(),
  api_key: z.string().trim().min(1).optional(),
  pool_id: z.string().trim().optional().nullable(),
  is_active: z.union([z.boolean(), z.number()]).optional(),
  is_free_tier: z.union([z.boolean(), z.number()]).optional(),
  daily_token_limit: z.number().int().min(0).optional(),
  budget_type: z.enum(['usd', 'tokens']).optional(),
  budget_cadence: z.enum(['daily', 'weekly', 'monthly', 'one-shot']).optional(),
  budget_limit: z.number().nonnegative().optional(),
  api_schema: ApiSchemaEnum.optional(),
  supported_schemas: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  custom_schema_config: z.string().trim().optional().nullable(),
});

export const BudgetCadenceEnum = z.enum(['daily', 'weekly', 'monthly', 'one-shot']);
export const BudgetTypeEnum = z.enum(['usd', 'tokens']);
export const ReasoningPolicyEnum = z.enum([
  'inherit',
  'low',
  'medium',
  'high',
  'max',
  'none',
  'fast',
]);

export const CreatePoolSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Pool ID is required')
    .regex(/^[a-z0-9_-]+$/i, 'Pool ID can only contain letters, numbers, hyphens, and underscores'),
  name: z.string().trim().min(1, 'Pool name is required'),
  description: z.string().trim().optional().nullable(),
  budget_type: BudgetTypeEnum.optional().default('tokens'),
  budget_cadence: BudgetCadenceEnum.optional().default('daily'),
  budget_limit: z.number().nonnegative().optional().default(0),
  allow_cross_model_fallback: z.union([z.boolean(), z.number()]).optional().default(false),
  reasoning_policy: z.string().trim().optional().default('inherit'),
});

export const UpdatePoolSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional().nullable(),
  budget_type: BudgetTypeEnum.optional(),
  budget_cadence: BudgetCadenceEnum.optional(),
  budget_limit: z.number().nonnegative().optional(),
  allow_cross_model_fallback: z.union([z.boolean(), z.number()]).optional(),
  reasoning_policy: z.string().trim().optional(),
});

export const SetPoolRoutesSchema = z.object({
  routes: z.array(z.object({
    id: z.string().trim().optional(),
    upstream_key_id: z.string().trim().min(1, 'upstream_key_id is required'),
    priority: z.number().int().nonnegative().default(0),
    model_pattern: z.string().trim().optional().default('*'),
    token_limit: z.number().int().nonnegative().optional().default(0),
    cost_limit: z.number().nonnegative().optional().default(0),
    reasoning_effort: z.string().trim().optional().nullable(),
  })),
});

export const CreateVirtualKeySchema = z.object({
  name: z.string().trim().min(1, 'Key name is required'),
  pool_id: z.string().trim().optional().nullable(),
  rate_limit_rpm: z.number().int().nonnegative().optional().default(0),
  budget_type: BudgetTypeEnum.optional().default('tokens'),
  budget_cadence: BudgetCadenceEnum.optional().default('daily'),
  budget_limit: z.number().nonnegative().optional().default(0),
  budget_monthly_usd: z.number().nonnegative().optional().default(0),
  allowed_pools: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  allowed_models: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  include_metadata: z.union([z.boolean(), z.number()]).optional().default(true),
});

export const UpdateVirtualKeySchema = z.object({
  name: z.string().trim().min(1).optional(),
  pool_id: z.string().trim().optional().nullable(),
  rate_limit_rpm: z.number().int().nonnegative().optional(),
  budget_type: BudgetTypeEnum.optional(),
  budget_cadence: BudgetCadenceEnum.optional(),
  budget_limit: z.number().nonnegative().optional(),
  budget_monthly_usd: z.number().nonnegative().optional(),
  is_active: z.union([z.boolean(), z.number()]).optional(),
  allowed_pools: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  allowed_models: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  include_metadata: z.union([z.boolean(), z.number()]).optional(),
});

export const SetupOptionsSchema = z.object({
  token: z.string({ error: 'Invite token is required' }).trim().min(1, 'Invite token is required'),
});

export const SetupVerifySchema = z.object({
  token: z.string({ error: 'Invite token is required' }).trim().min(1, 'Invite token is required'),
  response: z.record(z.string(), z.any(), { error: 'Registration response is required' }).refine((r) => Boolean(r && r.id), {
    message: 'Valid registration response with credential ID is required',
  }),
});

export const CreatePricingRuleSchema = z.object({
  model: z.string().trim().min(1, 'Model name or wildcard is required'),
  provider: z.string().trim().optional().nullable(),
  upstream_key_id: z.string().trim().optional().nullable(),
  capy_key_id: z.string().trim().optional().nullable(),
  prompt_price_per_1m: z.number().nonnegative('Prompt price must be non-negative'),
  completion_price_per_1m: z.number().nonnegative('Completion price must be non-negative'),
});

export const UpdatePricingRuleSchema = z.object({
  model: z.string().trim().min(1).optional(),
  provider: z.string().trim().optional().nullable(),
  upstream_key_id: z.string().trim().optional().nullable(),
  capy_key_id: z.string().trim().optional().nullable(),
  prompt_price_per_1m: z.number().nonnegative().optional(),
  completion_price_per_1m: z.number().nonnegative().optional(),
});

export const SaveTelegramSettingsSchema = z.object({
  is_enabled: z.union([z.boolean(), z.number()]),
  bot_token: z.string().trim().optional().nullable(),
  chat_id: z.string().trim().min(1, 'Chat ID is required'),
  notify_on_budget_warning: z.union([z.boolean(), z.number()]).optional(),
  notify_on_budget_exceeded: z.union([z.boolean(), z.number()]).optional(),
  notify_on_key_cooldown: z.union([z.boolean(), z.number()]).optional(),
  notify_on_key_error: z.union([z.boolean(), z.number()]).optional(),
});

export const TestTelegramSchema = z.object({
  bot_token: z.string().trim().optional().nullable(),
  chat_id: z.string().trim().optional().nullable(),
});

export const UpdateSystemSettingsSchema = z.object({
  daily_reset_hour: z.number().int().min(0).max(23),
});
