import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../src/db/schema';
import { runMigrations } from '../src/db/migrate';
import path from 'node:path';

describe('Drizzle Native Migrations & Deployment Harness', () => {
  test('executes Drizzle migrations on fresh database and records entries in __drizzle_migrations', () => {
    const db = new Database(':memory:');
    const drizzleDb = drizzle(db, { schema });
    const migrationsFolder = path.resolve(import.meta.dir, '../drizzle');

    // Run migrations using programmatic runner
    runMigrations(migrationsFolder, drizzleDb, db);

    // Verify __drizzle_migrations table exists
    const entries = db.query('SELECT * FROM __drizzle_migrations ORDER BY created_at ASC').all() as any[];
    expect(entries.length).toBeGreaterThanOrEqual(1);

    // Verify all schema tables are queryable via Drizzle ORM
    const pools = drizzleDb.select().from(schema.pools).all();
    expect(pools).toBeArray();

    const upstreamKeys = drizzleDb.select().from(schema.upstreamKeys).all();
    expect(upstreamKeys).toBeArray();

    const poolRoutes = drizzleDb.select().from(schema.poolRoutes).all();
    expect(poolRoutes).toBeArray();
  });

  test('safely migrates pre-existing database without data loss or duplicate column collision', () => {
    const db = new Database(':memory:');
    // Simulate pre-existing production schema (07f2d7c)
    db.run("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL);");
    db.run("CREATE TABLE pools (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);");
    db.run("INSERT INTO users VALUES ('u-prod', 'founder@startup.com', 'admin', 1000);");
    db.run("INSERT INTO pools VALUES ('p-prod', 'Main Cluster', 'Core apps', 1000, 1000);");

    const migrationsFolder = path.resolve(import.meta.dir, '../drizzle');
    const drizzleDb = drizzle(db, { schema });

    // Should succeed cleanly without table or column collision
    expect(() => {
      // Import migrator directly to verify migration on this specific db
      const { migrate } = require('drizzle-orm/bun-sqlite/migrator');
      migrate(drizzleDb, { migrationsFolder });
    }).not.toThrow();

    // Verify original data is 100% intact
    const user = db.query("SELECT * FROM users WHERE id = 'u-prod'").get() as any;
    expect(user).toBeDefined();
    expect(user.email).toBe('founder@startup.com');

    const pool = db.query("SELECT * FROM pools WHERE id = 'p-prod'").get() as any;
    expect(pool).toBeDefined();
    expect(pool.name).toBe('Main Cluster');
    expect(pool.description).toBe('Core apps');
  });

  test('safely migrates production database when columns like reasoning_policy already exist (Venus scenario)', () => {
    const db = new Database(':memory:');
    // Simulate Venus production database where pools and pool_routes already have reasoning columns applied
    db.run(`
      CREATE TABLE pools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        reasoning_policy TEXT NOT NULL DEFAULT 'inherit',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE pool_routes (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        upstream_key_id TEXT NOT NULL,
        priority INTEGER DEFAULT 0 NOT NULL,
        model_pattern TEXT DEFAULT '*' NOT NULL,
        token_limit INTEGER DEFAULT 0 NOT NULL,
        current_tokens INTEGER DEFAULT 0 NOT NULL,
        cost_limit REAL DEFAULT 0 NOT NULL,
        current_cost REAL DEFAULT 0 NOT NULL,
        reasoning_effort TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE request_logs (
        id TEXT PRIMARY KEY,
        virtual_key_id TEXT,
        upstream_key_id TEXT,
        pool_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER DEFAULT 0 NOT NULL,
        completion_tokens INTEGER DEFAULT 0 NOT NULL,
        total_tokens INTEGER DEFAULT 0 NOT NULL,
        cost_usd REAL DEFAULT 0 NOT NULL,
        latency_ms INTEGER DEFAULT 0 NOT NULL,
        ttft_ms INTEGER,
        status_code INTEGER DEFAULT 200 NOT NULL,
        error_message TEXT,
        streamed INTEGER DEFAULT 0 NOT NULL,
        aborted INTEGER DEFAULT 0 NOT NULL,
        endpoint TEXT NOT NULL,
        adaptation_meta TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    db.run("INSERT INTO pools VALUES ('p-venus', 'Venus Pool', 'Prod cluster', 'medium', 1000, 1000);");

    const migrationsFolder = path.resolve(import.meta.dir, '../drizzle');
    const drizzleDb = drizzle(db, { schema });

    // Must NOT crash with "duplicate column name: reasoning_policy"
    expect(() => {
      runMigrations(migrationsFolder, drizzleDb, db);
    }).not.toThrow();

    // Verify original data intact and reasoning_policy retained
    const pool = db.query("SELECT * FROM pools WHERE id = 'p-venus'").get() as any;
    expect(pool).toBeDefined();
    expect(pool.name).toBe('Venus Pool');
    expect(pool.reasoning_policy).toBe('medium');

    // Verify initial migration recorded in __drizzle_migrations
    const entries = db.query("SELECT * FROM __drizzle_migrations").all() as any[];
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});
