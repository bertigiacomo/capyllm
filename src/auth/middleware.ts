import type { Context, Next } from 'hono';
import { getSessionCookie, type SessionData } from './session';

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionData;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const session = await getSessionCookie(c);
  if (!session) {
    return c.json({ error: 'Unauthorized: Session missing or expired' }, 401);
  }
  c.set('user', session);
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  const session = await getSessionCookie(c);
  if (!session) {
    return c.json({ error: 'Unauthorized: Session missing or expired' }, 401);
  }
  if (session.role !== 'admin') {
    return c.json({ error: 'Forbidden: Admin access required' }, 403);
  }
  c.set('user', session);
  await next();
}
