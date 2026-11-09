import { getDatabase, getDrizzleDb } from '../db';
import type { Database } from 'bun:sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export function runMigrations(
  customFolder?: string,
  customDrizzleDb?: BunSQLiteDatabase<typeof schema>,
  customRawDb?: Database
): void {
  const db = customRawDb || (customDrizzleDb ? (customDrizzleDb as any).session.client : getDatabase());
  const drizzleDb = customDrizzleDb || getDrizzleDb();

  let folder = customFolder;
  if (!folder) {
    const candidates = [
      path.resolve(process.cwd(), 'drizzle'),
      path.resolve(import.meta.dir, '../../drizzle'),
      path.resolve(import.meta.dir, '../drizzle'),
      '/app/drizzle',
    ];
    folder = candidates.find((c) => existsSync(c)) || candidates[0];
  }

  // Ensure __drizzle_migrations table exists for tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  // Read migrations defined in drizzle folder
  const migrations = readMigrationFiles({ migrationsFolder: folder });

  // Safely execute statements with duplicate-column guard for pre-existing databases
  for (const m of migrations) {
    const alreadyLogged = db.query('SELECT 1 FROM __drizzle_migrations WHERE hash = ?').get(m.hash);
    if (alreadyLogged) {
      continue;
    }

    for (const stmt of m.sql) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;

      // Check if this statement is an ALTER TABLE ... ADD COLUMN ...
      const alterMatch = trimmed.match(
        /ALTER\s+TABLE\s+[`"']?([a-zA-Z0-9_]+)[`"']?\s+ADD\s+(?:COLUMN\s+)?[`"']?([a-zA-Z0-9_]+)[`"']?/i
      );

      if (alterMatch) {
        const tableName = alterMatch[1];
        const colName = alterMatch[2];

        try {
          const tableExists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
          if (tableExists) {
            const cols = (db.query(`PRAGMA table_info("${tableName}")`).all() as any[]).map((c) => c.name);
            if (cols.includes(colName)) {
              // Column already exists in table from pre-existing schema, skip statement safely
              continue;
            }
          }
        } catch {}
      }

      // Execute statement, catching any redundant duplicate-column / table-exists errors
      try {
        db.run(trimmed);
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (msg.includes('duplicate column name') || msg.includes('already exists')) {
          // Schema element already applied in pre-existing database, continue safely
          continue;
        }
        throw err;
      }
    }

    // Mark migration as completed in __drizzle_migrations
    db.query('INSERT OR IGNORE INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(m.hash, m.folderMillis);
  }

  // Final synchronization with Drizzle migrator
  try {
    migrate(drizzleDb, { migrationsFolder: folder });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('duplicate column name') || msg.includes('already exists')) {
      // Benign collision on pre-existing schema
    } else {
      throw err;
    }
  }
}

if (import.meta.main) {
  console.log('Running Drizzle native migrations...');
  runMigrations();
  console.log('Drizzle migrations completed successfully.');
}
