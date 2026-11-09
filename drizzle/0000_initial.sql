CREATE TABLE IF NOT EXISTS `model_pricing` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`provider` text,
	`upstream_key_id` text,
	`capy_key_id` text,
	`prompt_price_per_1m` real DEFAULT 0 NOT NULL,
	`completion_price_per_1m` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`upstream_key_id`) REFERENCES `upstream_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capy_key_id`) REFERENCES `virtual_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_pricing_model` ON `model_pricing` (`model`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_pricing_provider` ON `model_pricing` (`provider`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_pricing_upstream_key` ON `model_pricing` (`upstream_key_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_model_pricing_capy_key` ON `model_pricing` (`capy_key_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `passkey_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text,
	`backed_up` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_passkey_credentials_user_id` ON `passkey_credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pool_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`upstream_key_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`model_pattern` text DEFAULT '*' NOT NULL,
	`token_limit` integer DEFAULT 0 NOT NULL,
	`current_tokens` integer DEFAULT 0 NOT NULL,
	`cost_limit` real DEFAULT 0 NOT NULL,
	`current_cost` real DEFAULT 0 NOT NULL,
	`reasoning_effort` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`upstream_key_id`) REFERENCES `upstream_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pool_routes_pool` ON `pool_routes` (`pool_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pool_routes_pool_priority` ON `pool_routes` (`pool_id`,`priority`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pool_routes_key` ON `pool_routes` (`upstream_key_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`budget_type` text DEFAULT 'tokens' NOT NULL,
	`budget_cadence` text DEFAULT 'daily' NOT NULL,
	`budget_limit` real DEFAULT 0,
	`current_spend_tokens` integer DEFAULT 0 NOT NULL,
	`current_spend_usd` real DEFAULT 0 NOT NULL,
	`spend_reset_at` integer DEFAULT 0 NOT NULL,
	`allow_cross_model_fallback` integer DEFAULT 0 NOT NULL,
	`reasoning_policy` text DEFAULT 'inherit' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pools_name_unique` ON `pools` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `request_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`virtual_key_id` text,
	`upstream_key_id` text,
	`pool_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`ttft_ms` integer,
	`status_code` integer DEFAULT 200 NOT NULL,
	`error_message` text,
	`streamed` integer DEFAULT 0 NOT NULL,
	`aborted` integer DEFAULT 0 NOT NULL,
	`endpoint` text NOT NULL,
	`adaptation_meta` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`virtual_key_id`) REFERENCES `virtual_keys`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`upstream_key_id`) REFERENCES `upstream_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_logs_created_at` ON `request_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_logs_virtual_key` ON `request_logs` (`virtual_key_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_logs_upstream_key` ON `request_logs` (`upstream_key_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_logs_pool` ON `request_logs` (`pool_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_logs_model` ON `request_logs` (`model`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_logs_provider` ON `request_logs` (`provider`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `telegram_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`is_enabled` integer DEFAULT 0 NOT NULL,
	`bot_token_encrypted` text,
	`chat_id` text,
	`notify_on_budget_warning` integer DEFAULT 1 NOT NULL,
	`notify_on_budget_exceeded` integer DEFAULT 1 NOT NULL,
	`notify_on_key_cooldown` integer DEFAULT 1 NOT NULL,
	`notify_on_key_error` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `upstream_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`is_free_tier` integer DEFAULT 0 NOT NULL,
	`cooldown_until` integer DEFAULT 0,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`discovered_models` text,
	`daily_token_limit` integer DEFAULT 0 NOT NULL,
	`current_daily_tokens` integer DEFAULT 0 NOT NULL,
	`daily_tokens_reset_at` integer DEFAULT 0 NOT NULL,
	`budget_type` text DEFAULT 'tokens' NOT NULL,
	`budget_cadence` text DEFAULT 'daily' NOT NULL,
	`budget_limit` real DEFAULT 0,
	`current_spend_tokens` integer DEFAULT 0 NOT NULL,
	`current_spend_usd` real DEFAULT 0 NOT NULL,
	`spend_reset_at` integer DEFAULT 0 NOT NULL,
	`api_schema` text DEFAULT 'chat_completions' NOT NULL,
	`supported_schemas` text DEFAULT '["chat_completions","responses","embeddings","decision"]' NOT NULL,
	`custom_schema_config` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_upstream_keys_pool` ON `upstream_keys` (`pool_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_invites_token_unique` ON `user_invites` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_invites_token` ON `user_invites` (`token`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `virtual_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`pool_id` text,
	`rate_limit_rpm` integer DEFAULT 0,
	`budget_type` text DEFAULT 'usd' NOT NULL,
	`budget_cadence` text DEFAULT 'monthly' NOT NULL,
	`budget_limit` real DEFAULT 0,
	`budget_monthly_usd` real DEFAULT 0,
	`current_spend_usd` real DEFAULT 0 NOT NULL,
	`current_spend_tokens` integer DEFAULT 0 NOT NULL,
	`spend_reset_at` integer DEFAULT 0 NOT NULL,
	`allowed_pools` text,
	`allowed_models` text,
	`include_metadata` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_budget_warning_at` integer DEFAULT 0 NOT NULL,
	`last_budget_exceeded_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `virtual_keys_key_hash_unique` ON `virtual_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_virtual_keys_hash` ON `virtual_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_virtual_keys_pool` ON `virtual_keys` (`pool_id`);