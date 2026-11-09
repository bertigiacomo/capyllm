import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { initDatabase } from './db';
import { v1Router } from './api/v1';
import { authRouter } from './api/auth';
import { adminRouter } from './api/admin';

// Initialize SQLite database
initDatabase();

export const app = new Hono();

// CORS for local development and API access
app.use('*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-capy-pool', 'x-goog-api-key'],
  exposeHeaders: ['x-capy-key-id', 'x-capy-provider', 'x-capy-latency-ms', 'x-capy-pool'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'CapyLLM', time: Date.now() }));

// Mount API Routers
app.route('/v1', v1Router);
app.route('/api/auth', authRouter);
app.route('/api/admin', adminRouter);

// Frontend static serving if dist exists
const distPath = './frontend/dist';
if (existsSync(distPath)) {
  app.use('/*', serveStatic({ root: distPath }));
  // Fallback to index.html for SPA client-side routes (like /auth/setup, /dashboard, etc.)
  app.get('*', serveStatic({ path: `${distPath}/index.html` }));
} else {
  app.get('/', (c) => {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>CapyLLM</title><meta charset="utf-8"></head>
        <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; line-height: 1.6;">
          <h1>CapyLLM Gateway</h1>
          <p>The backend is running. Frontend has not been built yet.</p>
          <p>Run <code>bun run build:frontend</code> to build the React dashboard.</p>
        </body>
      </html>
    `);
  });
}

const port = parseInt(process.env.PORT || '3000', 10);

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  console.log(`CapyLLM server running on http://localhost:${port}`);
}
