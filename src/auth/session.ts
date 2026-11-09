import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';

const SESSION_COOKIE_NAME = 'capy_session';
const CHALLENGE_COOKIE_NAME = 'capy_challenge';

export interface SessionData {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: number;
}

export function getCookieSecret(): string {
  return process.env.CAPY_COOKIE_SECRET || process.env.CAPY_MASTER_KEY || 'capyllm-default-session-secret-change-in-prod';
}

export async function setChallengeCookie(c: Context, challenge: string): Promise<void> {
  const secret = getCookieSecret();
  const isSecure = c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https';
  await setSignedCookie(c, CHALLENGE_COOKIE_NAME, challenge, secret, {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    maxAge: 300, // 5 minutes
  });
}

export async function getChallengeCookie(c: Context): Promise<string | null> {
  const secret = getCookieSecret();
  const val = await getSignedCookie(c, secret, CHALLENGE_COOKIE_NAME);
  return typeof val === 'string' ? val : null;
}

export async function clearChallengeCookie(c: Context): Promise<void> {
  deleteCookie(c, CHALLENGE_COOKIE_NAME, { path: '/' });
}

export async function setSessionCookie(c: Context, session: SessionData): Promise<void> {
  const secret = getCookieSecret();
  const isSecure = c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https';
  const val = JSON.stringify(session);
  await setSignedCookie(c, SESSION_COOKIE_NAME, val, secret, {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function getSessionCookie(c: Context): Promise<SessionData | null> {
  const secret = getCookieSecret();
  const val = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
  if (typeof val !== 'string') return null;

  try {
    const data = JSON.parse(val);
    if (data && data.userId && data.email && data.role) {
      return data as SessionData;
    }
  } catch {}
  return null;
}

export async function clearSessionCookie(c: Context): Promise<void> {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

export async function createTestSessionCookie(session: SessionData): Promise<string> {
  const { generateSignedCookie } = await import('hono/cookie');
  const secret = getCookieSecret();
  const val = JSON.stringify(session);
  return await generateSignedCookie(SESSION_COOKIE_NAME, val, secret);
}
