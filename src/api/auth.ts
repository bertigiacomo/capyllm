import { Hono } from 'hono';
import crypto from 'node:crypto';
import { getDatabase, type User, type UserInvite, type PasskeyCredential } from '../db';
import {
  createRegistrationOptions,
  verifyRegistration,
  createAuthenticationOptions,
  verifyAuthentication,
} from '../auth/passkey';
import {
  setChallengeCookie,
  getChallengeCookie,
  clearChallengeCookie,
  setSessionCookie,
  getSessionCookie,
  clearSessionCookie,
} from '../auth/session';

export const authRouter = new Hono();

import { SetupOptionsSchema, SetupVerifySchema } from '../schema';

// POST /api/auth/setup/options
authRouter.post('/setup/options', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SetupOptionsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid request body' }, 400);
  }
  const token = parsed.data.token;

  const db = getDatabase();
  const invite = db.query('SELECT * FROM user_invites WHERE token = ?').get(token) as UserInvite | null;

  if (!invite) {
    return c.json({ error: 'Invalid or non-existent invite token' }, 404);
  }
  if (invite.used_at) {
    return c.json({ error: 'This invite has already been used' }, 400);
  }
  if (invite.expires_at < Date.now()) {
    return c.json({ error: 'This invite token has expired' }, 400);
  }

  // Consistent userId using existing user.id or invite.id
  let user = db.query('SELECT * FROM users WHERE email = ?').get(invite.email) as User | null;
  const userId = user?.id || invite.id;

  const options = await createRegistrationOptions(c, userId, invite.email);
  await setChallengeCookie(c, options.challenge);

  return c.json({
    options,
    email: invite.email,
  });
});

// POST /api/auth/setup/verify
authRouter.post('/setup/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SetupVerifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Token and registration response are required' }, 400);
  }
  const { token, response } = parsed.data;

  const db = getDatabase();
  const invite = db.query('SELECT * FROM user_invites WHERE token = ?').get(token) as UserInvite | null;

  if (!invite || invite.used_at || invite.expires_at < Date.now()) {
    return c.json({ error: 'Invalid, used, or expired invite' }, 400);
  }

  const expectedChallenge = await getChallengeCookie(c);
  if (!expectedChallenge) {
    return c.json({ error: 'Registration challenge expired or missing' }, 400);
  }
  // Single-use challenge: clear immediately
  await clearChallengeCookie(c);

  try {
    const verification = await verifyRegistration(c, response, expectedChallenge);
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Registration verification failed' }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Create or get user using consistent ID
    let user = db.query('SELECT * FROM users WHERE email = ?').get(invite.email) as User | null;
    const now = Date.now();
    if (!user) {
      user = {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        created_at: now,
      };
      db.query('INSERT INTO users (id, email, role, created_at) VALUES (?, ?, ?, ?)').run(
        user.id,
        user.email,
        user.role,
        user.created_at
      );
    }

    // Save Passkey Credential
    const pubKeyBase64url = Buffer.from(credential.publicKey).toString('base64url');
    db.query(`
      INSERT INTO passkey_credentials (
        id, user_id, public_key, counter, device_type, backed_up, transports, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      credential.id,
      user.id,
      pubKeyBase64url,
      credential.counter,
      credentialDeviceType || null,
      credentialBackedUp ? 1 : 0,
      credential.transports ? JSON.stringify(credential.transports) : null,
      now
    );

    // Mark invite as used
    db.query('UPDATE user_invites SET used_at = ? WHERE id = ?').run(now, invite.id);

    await clearChallengeCookie(c);

    // Set signed session cookie
    const sessionData = {
      userId: user.id,
      email: user.email,
      role: user.role,
      createdAt: now,
    };
    await setSessionCookie(c, sessionData);

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Verification failed' }, 400);
  }
});

// POST /api/auth/login/options
authRouter.post('/login/options', async (c) => {
  const options = await createAuthenticationOptions(c);
  await setChallengeCookie(c, options.challenge);
  return c.json({ options });
});

// POST /api/auth/login/verify
authRouter.post('/login/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { response } = body;

  if (!response || !response.id) {
    return c.json({ error: 'Missing authentication response or credential ID' }, 400);
  }

  const expectedChallenge = await getChallengeCookie(c);
  if (!expectedChallenge) {
    return c.json({ error: 'Authentication challenge expired or missing' }, 400);
  }
  // Single-use challenge: clear immediately
  await clearChallengeCookie(c);

  const db = getDatabase();
  const credential = db.query('SELECT * FROM passkey_credentials WHERE id = ?').get(response.id) as PasskeyCredential | null;
  if (!credential) {
    return c.json({ error: 'Unrecognized passkey credential' }, 400);
  }

  const user = db.query('SELECT * FROM users WHERE id = ?').get(credential.user_id) as User | null;
  if (!user) {
    return c.json({ error: 'User associated with this credential not found' }, 400);
  }

  try {
    const pubKeyUint8 = Buffer.from(credential.public_key, 'base64url');
    let transports: any[] | undefined = undefined;
    if (credential.transports) {
      try {
        transports = JSON.parse(credential.transports);
      } catch {}
    }

    const verification = await verifyAuthentication(c, response, expectedChallenge, {
      id: credential.id,
      publicKey: pubKeyUint8,
      counter: credential.counter,
      transports,
    });

    if (!verification.verified) {
      return c.json({ error: 'Authentication verification failed' }, 400);
    }

    // Update credential counter
    db.query('UPDATE passkey_credentials SET counter = ? WHERE id = ?').run(
      verification.authenticationInfo.newCounter,
      credential.id
    );

    await clearChallengeCookie(c);

    // Set signed session cookie
    const now = Date.now();
    const sessionData = {
      userId: user.id,
      email: user.email,
      role: user.role,
      createdAt: now,
    };
    await setSessionCookie(c, sessionData);

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Passkey verification failed' }, 400);
  }
});

// GET /api/auth/me
authRouter.get('/me', async (c) => {
  const session = await getSessionCookie(c);
  if (!session) {
    return c.json({ authenticated: false, user: null });
  }
  return c.json({ authenticated: true, user: session });
});

// POST /api/auth/logout
authRouter.post('/logout', async (c) => {
  await clearSessionCookie(c);
  return c.json({ success: true });
});
