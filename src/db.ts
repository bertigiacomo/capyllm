import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './db/schema';

export { schema };
export * from './db/schema';

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  created_at: number;
}

export interface PasskeyCredential {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  device_type: string | null;
  backed_up: number;
  transports: string | null;
  created_at: number;
}

export interface UserInvite {
  id: string;
  email: string;
  role: 'admin' | 'user';
  token: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

export interface Pool {
  id: string;
  name: string;
  description: string | null;
  budget_type: BudgetType;
  budget_cadence: BudgetCadence;
  budget_limit: number;
  current_spend_tokens: number;
  current_spend_usd: number;
  spend_reset_at: number;
  allow_cross_model_fallback?: number;
  reasoning_policy?: string; // 'inherit' | 'low' | 'medium' | 'high' | 'none'
  created_at: number;
  updated_at: number;
}

export interface PoolRoute {
  id: string;
  pool_id: string;
  upstream_key_id: string;
  priority: number;
  model_pattern: string;
  token_limit: number;
  current_tokens: number;
  cost_limit: number;
  current_cost: number;
  reasoning_effort?: string | null;
  created_at: number;
}

export interface UpstreamKey {
  id: string;
  pool_id?: string | null;
  provider: string; // 'openai' | 'gemini' | 'groq' | 'mistral' | 'deepseek' | 'openrouter' | 'together' | 'ollama' | 'jev' | 'custom'
  name: string;
  base_url: string;
  encrypted_key: string;
  is_active: number; // 0 or 1
  is_free_tier?: number; // 0 or 1
  cooldown_until: number; // unix timestamp ms
  fail_count: number;
  last_error: string | null;
  discovered_models?: string | null; // JSON array of string model IDs
  daily_token_limit?: number; // legacy 0 = unlimited, >0 = maximum tokens allowed per day
  current_daily_tokens?: number; // legacy tokens accumulated in current daily window
  daily_tokens_reset_at?: number; // legacy unix timestamp ms when daily tokens counter resets
  budget_type?: BudgetType;
  budget_cadence?: BudgetCadence;
  budget_limit?: number;
  current_spend_tokens?: number;
  current_spend_usd?: number;
  spend_reset_at?: number;
  api_schema: 'chat_completions' | 'responses' | 'decision' | 'custom';
  supported_schemas?: string | null;
  custom_schema_config?: string | null; // Custom JSON mapping or body/header templates
  created_at: number;
  updated_at: number;
}

export type CapyKey = VirtualKey;

export type BudgetCadence = 'daily' | 'weekly' | 'monthly' | 'one-shot';
export type BudgetType = 'usd' | 'tokens';

export interface VirtualKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  pool_id?: string | null;
  rate_limit_rpm: number;
  budget_type: BudgetType;
  budget_cadence: BudgetCadence;
  budget_limit: number;
  budget_monthly_usd: number;
  current_spend_usd: number;
  current_spend_tokens: number;
  spend_reset_at: number;
  allowed_pools: string | null; // JSON array of pool IDs or null
  allowed_models: string | null; // JSON array of model names or null
  include_metadata: number; // 0 = false (pure vanilla OpenAI JSON), 1 = true (inject capy_meta)
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface SystemSetting {
  key: string;
  value: string;
  updated_at: number;
}

export function getSystemSetting(key: string, defaultValue = ''): string {
  try {
    const db = getDatabase();
    const row = db.query('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setSystemSetting(key: string, value: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export function getDailyResetHour(): number {
  const raw = getSystemSetting('daily_reset_hour', '0');
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed < 0 || parsed > 23 ? 0 : parsed;
}

export function calculateNextResetAt(cadence: BudgetCadence, fromTime = Date.now(), resetHour?: number): number {
  if (cadence === 'one-shot') {
    return 0; // Never resets automatically
  }
  const h = resetHour !== undefined ? resetHour : getDailyResetHour();
  const d = new Date(fromTime);

  if (cadence === 'daily') {
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
    if (target.getTime() <= fromTime) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (cadence === 'weekly') {
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
    const day = d.getDay(); // 0 = Sun, 1 = Mon ...
    let daysUntilMonday = (1 - day + 7) % 7;
    if (daysUntilMonday === 0 && target.getTime() <= fromTime) {
      daysUntilMonday = 7;
    }
    target.setDate(target.getDate() + daysUntilMonday);
    return target.getTime();
  }

  // Monthly: 1st of next month at h:00:00.000
  const target = new Date(d.getFullYear(), d.getMonth() + 1, 1, h, 0, 0, 0);
  return target.getTime();
}

export interface ModelPricing {
  id: string;
  model: string;
  provider: string | null;
  upstream_key_id: string | null;
  capy_key_id: string | null;
  prompt_price_per_1m: number;
  completion_price_per_1m: number;
  created_at: number;
  updated_at: number;
}

export interface TelegramSettings {
  id: string;
  is_enabled: number;
  bot_token_encrypted: string | null;
  chat_id: string | null;
  notify_on_budget_warning: number;
  notify_on_budget_exceeded: number;
  notify_on_key_cooldown: number;
  notify_on_key_error: number;
  created_at: number;
  updated_at: number;
}

export interface RequestLog {
  id: string;
  virtual_key_id: string | null;
  upstream_key_id: string | null;
  pool_id: string | null;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
  ttft_ms: number | null;
  status_code: number;
  error_message: string | null;
  streamed: number;
  aborted: number;
  endpoint: string;
  adaptation_meta?: string | null;
  created_at: number;
}

let dbInstance: Database | null = null;
let drizzleInstance: BunSQLiteDatabase<typeof schema> | null = null;

export function initDatabase(customPath?: string): Database {
  const dbPath = customPath || process.env.CAPY_DB_PATH || process.env.DATABASE_URL || './data/capyllm.db';

  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Requirement: PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA busy_timeout = 5000;');
  db.run('PRAGMA synchronous = NORMAL;');
  db.run('PRAGMA foreign_keys = ON;');

  // Migrations
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      budget_type TEXT NOT NULL DEFAULT 'tokens',
      budget_cadence TEXT NOT NULL DEFAULT 'daily',
      budget_limit REAL DEFAULT 0,
      current_spend_tokens INTEGER NOT NULL DEFAULT 0,
      current_spend_usd REAL NOT NULL DEFAULT 0,
      spend_reset_at INTEGER NOT NULL DEFAULT 0,
      allow_cross_model_fallback INTEGER NOT NULL DEFAULT 0,
      reasoning_policy TEXT NOT NULL DEFAULT 'inherit',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migrations for pools budget fields
  try { db.run("ALTER TABLE pools ADD COLUMN budget_type TEXT NOT NULL DEFAULT 'tokens';"); } catch {}
  try { db.run("ALTER TABLE pools ADD COLUMN budget_cadence TEXT NOT NULL DEFAULT 'daily';"); } catch {}
  try { db.run("ALTER TABLE pools ADD COLUMN budget_limit REAL DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE pools ADD COLUMN current_spend_tokens INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE pools ADD COLUMN current_spend_usd REAL NOT NULL DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE pools ADD COLUMN spend_reset_at INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE pools ADD COLUMN allow_cross_model_fallback INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE pools ADD COLUMN reasoning_policy TEXT NOT NULL DEFAULT 'inherit';"); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS upstream_keys (
      id TEXT PRIMARY KEY,
      pool_id TEXT,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      cooldown_until INTEGER DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      discovered_models TEXT,
      api_schema TEXT NOT NULL DEFAULT 'chat_completions',
      supported_schemas TEXT NOT NULL DEFAULT '["chat_completions","responses","embeddings","decision"]',
      custom_schema_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migrate columns for upstream_keys
  try { db.run('ALTER TABLE upstream_keys ADD COLUMN discovered_models TEXT;'); } catch {}
  try { db.run("ALTER TABLE upstream_keys ADD COLUMN api_schema TEXT NOT NULL DEFAULT 'chat_completions';"); } catch {}
  try { db.run("ALTER TABLE upstream_keys ADD COLUMN supported_schemas TEXT NOT NULL DEFAULT '[\"chat_completions\",\"responses\",\"embeddings\",\"decision\"]';"); } catch {}
  try { db.run('ALTER TABLE upstream_keys ADD COLUMN custom_schema_config TEXT;'); } catch {}

  // Junction table: pool_routes (N:N relationship between pools and upstream keys with priority, pattern & per-route limits)
  db.run(`
    CREATE TABLE IF NOT EXISTS pool_routes (
      id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      upstream_key_id TEXT NOT NULL REFERENCES upstream_keys(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 0,
      model_pattern TEXT NOT NULL DEFAULT '*',
      token_limit INTEGER NOT NULL DEFAULT 0,
      current_tokens INTEGER NOT NULL DEFAULT 0,
      cost_limit REAL NOT NULL DEFAULT 0,
      current_cost REAL NOT NULL DEFAULT 0,
      reasoning_effort TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  try { db.run('ALTER TABLE pool_routes ADD COLUMN token_limit INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { db.run('ALTER TABLE pool_routes ADD COLUMN current_tokens INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { db.run('ALTER TABLE pool_routes ADD COLUMN cost_limit REAL NOT NULL DEFAULT 0;'); } catch {}
  try { db.run('ALTER TABLE pool_routes ADD COLUMN current_cost REAL NOT NULL DEFAULT 0;'); } catch {}
  try { db.run('ALTER TABLE pool_routes ADD COLUMN reasoning_effort TEXT;'); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS virtual_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      pool_id TEXT REFERENCES pools(id) ON DELETE SET NULL,
      rate_limit_rpm INTEGER DEFAULT 0,
      budget_type TEXT NOT NULL DEFAULT 'usd',
      budget_cadence TEXT NOT NULL DEFAULT 'monthly',
      budget_limit REAL DEFAULT 0,
      budget_monthly_usd REAL DEFAULT 0,
      current_spend_usd REAL NOT NULL DEFAULT 0,
      current_spend_tokens INTEGER NOT NULL DEFAULT 0,
      spend_reset_at INTEGER NOT NULL DEFAULT 0,
      allowed_pools TEXT,
      allowed_models TEXT,
      include_metadata INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migrations for virtual_keys budget & pool extensions
  try { db.run("ALTER TABLE virtual_keys ADD COLUMN pool_id TEXT REFERENCES pools(id) ON DELETE SET NULL;"); } catch {}
  try { db.run("ALTER TABLE virtual_keys ADD COLUMN budget_type TEXT NOT NULL DEFAULT 'usd';"); } catch {}
  try { db.run("ALTER TABLE virtual_keys ADD COLUMN budget_cadence TEXT NOT NULL DEFAULT 'monthly';"); } catch {}
  try { db.run("ALTER TABLE virtual_keys ADD COLUMN budget_limit REAL DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE virtual_keys ADD COLUMN current_spend_tokens INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE virtual_keys ADD COLUMN include_metadata INTEGER NOT NULL DEFAULT 1;"); } catch {}
  try { db.run("UPDATE virtual_keys SET budget_limit = budget_monthly_usd WHERE budget_limit = 0 AND budget_monthly_usd > 0;"); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      virtual_key_id TEXT REFERENCES virtual_keys(id) ON DELETE SET NULL,
      upstream_key_id TEXT REFERENCES upstream_keys(id) ON DELETE SET NULL,
      pool_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      ttft_ms INTEGER DEFAULT NULL,
      status_code INTEGER NOT NULL DEFAULT 200,
      error_message TEXT,
      streamed INTEGER NOT NULL DEFAULT 0,
      aborted INTEGER NOT NULL DEFAULT 0,
      endpoint TEXT NOT NULL,
      adaptation_meta TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  try {
    db.run('ALTER TABLE request_logs ADD COLUMN adaptation_meta TEXT;');
  } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS model_pricing (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      provider TEXT,
      upstream_key_id TEXT REFERENCES upstream_keys(id) ON DELETE CASCADE,
      capy_key_id TEXT REFERENCES virtual_keys(id) ON DELETE CASCADE,
      prompt_price_per_1m REAL NOT NULL DEFAULT 0,
      completion_price_per_1m REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS telegram_settings (
      id TEXT PRIMARY KEY,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      bot_token_encrypted TEXT,
      chat_id TEXT,
      notify_on_budget_warning INTEGER NOT NULL DEFAULT 1,
      notify_on_budget_exceeded INTEGER NOT NULL DEFAULT 1,
      notify_on_key_cooldown INTEGER NOT NULL DEFAULT 1,
      notify_on_key_error INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migrations for upstream_keys & virtual_keys
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN is_free_tier INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN daily_token_limit INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN current_daily_tokens INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN daily_tokens_reset_at INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run("ALTER TABLE upstream_keys ADD COLUMN budget_type TEXT NOT NULL DEFAULT 'tokens';");
  } catch {}
  try {
    db.run("ALTER TABLE upstream_keys ADD COLUMN budget_cadence TEXT NOT NULL DEFAULT 'daily';");
  } catch {}
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN budget_limit REAL DEFAULT 0;');
  } catch {}
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN current_spend_tokens INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN current_spend_usd REAL NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run('ALTER TABLE upstream_keys ADD COLUMN spend_reset_at INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run(`
      UPDATE upstream_keys
      SET budget_limit = daily_token_limit,
          current_spend_tokens = current_daily_tokens,
          spend_reset_at = daily_tokens_reset_at
      WHERE (budget_limit IS NULL OR budget_limit = 0) AND daily_token_limit > 0;
    `);
  } catch {}
  try {
    db.run('ALTER TABLE virtual_keys ADD COLUMN last_budget_warning_at INTEGER NOT NULL DEFAULT 0;');
  } catch {}
  try {
    db.run('ALTER TABLE virtual_keys ADD COLUMN last_budget_exceeded_at INTEGER NOT NULL DEFAULT 0;');
  } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Indexes for high performance
  db.run('CREATE INDEX IF NOT EXISTS idx_virtual_keys_hash ON virtual_keys(key_hash);');
  db.run('CREATE INDEX IF NOT EXISTS idx_virtual_keys_pool ON virtual_keys(pool_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_upstream_keys_pool ON upstream_keys(pool_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_pool_routes_pool ON pool_routes(pool_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_pool_routes_pool_priority ON pool_routes(pool_id, priority ASC);');
  db.run('CREATE INDEX IF NOT EXISTS idx_pool_routes_key ON pool_routes(upstream_key_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);');
  db.run('CREATE INDEX IF NOT EXISTS idx_request_logs_virtual_key ON request_logs(virtual_key_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_request_logs_upstream_key ON request_logs(upstream_key_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_request_logs_pool ON request_logs(pool_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model);');
  db.run('CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(provider);');
  db.run('CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id ON passkey_credentials(user_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_user_invites_token ON user_invites(token);');
  db.run('CREATE INDEX IF NOT EXISTS idx_model_pricing_model ON model_pricing(model);');
  db.run('CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider);');
  db.run('CREATE INDEX IF NOT EXISTS idx_model_pricing_upstream_key ON model_pricing(upstream_key_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_model_pricing_capy_key ON model_pricing(capy_key_id);');

  // One-time data migrations for pool_routes from existing upstream_keys
  try {
    const existingKeys = db.query("SELECT id, pool_id FROM upstream_keys WHERE pool_id IS NOT NULL AND pool_id != ''").all() as { id: string; pool_id: string }[];
    for (const k of existingKeys) {
      const exists = db.query('SELECT 1 FROM pool_routes WHERE pool_id = ? AND upstream_key_id = ?').get(k.pool_id, k.id);
      if (!exists) {
        db.query('INSERT INTO pool_routes (id, pool_id, upstream_key_id, priority, model_pattern, created_at) VALUES (?, ?, ?, 0, ?, ?)')
          .run(crypto.randomUUID(), k.pool_id, k.id, '*', Date.now());
      }
    }
  } catch {}

  // One-time data migration for virtual_keys.pool_id from allowed_pools
  try {
    const vkeys = db.query("SELECT id, allowed_pools FROM virtual_keys WHERE pool_id IS NULL AND allowed_pools IS NOT NULL AND allowed_pools != ''").all() as { id: string; allowed_pools: string }[];
    for (const vk of vkeys) {
      try {
        const poolsArr = JSON.parse(vk.allowed_pools);
        if (Array.isArray(poolsArr) && poolsArr.length > 0 && poolsArr[0] !== '*') {
          db.query('UPDATE virtual_keys SET pool_id = ? WHERE id = ?').run(poolsArr[0], vk.id);
        }
      } catch {}
    }
  } catch {}

  dbInstance = db;
  drizzleInstance = null;
  return db;
}

export function getDatabase(): Database {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function getDrizzleDb(): BunSQLiteDatabase<typeof schema> {
  const sqlite = getDatabase();
  if (!drizzleInstance) {
    drizzleInstance = drizzle(sqlite, { schema });
  }
  return drizzleInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    drizzleInstance = null;
  }
}
