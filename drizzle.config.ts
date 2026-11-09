import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.CAPY_DB_PATH || process.env.DATABASE_URL || './data/capyllm.db',
  },
});
