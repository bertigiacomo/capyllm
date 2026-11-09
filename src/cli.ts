#!/usr/bin/env bun
import crypto from 'node:crypto';
import { initDatabase, getDatabase, type User, type UserInvite } from './db';

// Ensure DB is initialized
initDatabase();
const db = getDatabase();

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
CapyLLM CLI
Usage:
  bun run cli add-user <email> [--admin]   Generate a 24h setup invite link
  bun run cli list-users                   List all registered users and pending invites
  bun run cli reset-cooldown [key_id]      Reset rate limit cooldown on upstream keys
  `);
}

async function handleAddUser(email: string, isAdmin: boolean) {
  if (!email || !email.includes('@')) {
    console.error('Error: Please provide a valid email address.');
    process.exit(1);
  }

  const role = isAdmin ? 'admin' : 'user';
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours
  const id = crypto.randomUUID();

  // Invalidate previous unused invites for this email
  db.query('UPDATE user_invites SET used_at = ? WHERE email = ? AND used_at IS NULL').run(now, email);

  db.query(`
    INSERT INTO user_invites (id, email, role, token, expires_at, used_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run(id, email, role, token, expiresAt, now);

  const origin = process.env.CAPY_ORIGIN || 'http://localhost:3000';
  const setupUrl = `${origin}/auth/setup?token=${token}`;

  console.log('\n=========================================');
  console.log(`CapyLLM Invite Created for ${email}`);
  console.log(`Role: ${role.toUpperCase()}`);
  console.log(`Expires in: 24 hours`);
  console.log('-----------------------------------------');
  console.log(`Setup URL:`);
  console.log(setupUrl);
  console.log('=========================================\n');
}

async function handleListUsers() {
  const users = db.query('SELECT * FROM users ORDER BY created_at DESC').all() as User[];
  const invites = db.query('SELECT * FROM user_invites WHERE used_at IS NULL AND expires_at > ?').all(Date.now()) as UserInvite[];

  console.log('\n--- Active Users ---');
  if (users.length === 0) {
    console.log('No users registered yet.');
  } else {
    for (const u of users) {
      console.log(`- ${u.email} [${u.role.toUpperCase()}] (ID: ${u.id})`);
    }
  }

  console.log('\n--- Pending Invites ---');
  if (invites.length === 0) {
    console.log('No pending invites.');
  } else {
    for (const inv of invites) {
      console.log(`- ${inv.email} [${inv.role.toUpperCase()}] (Expires: ${new Date(inv.expires_at).toISOString()})`);
      console.log(`  Token: ${inv.token}`);
    }
  }
  console.log('');
}

async function handleResetCooldown(keyId?: string) {
  if (keyId) {
    db.query('UPDATE upstream_keys SET cooldown_until = 0, fail_count = 0, last_error = NULL WHERE id = ?').run(keyId);
    console.log(`Cooldown reset for key: ${keyId}`);
  } else {
    db.query('UPDATE upstream_keys SET cooldown_until = 0, fail_count = 0, last_error = NULL').run();
    console.log('Cooldown reset for ALL upstream keys.');
  }
}

async function main() {
  switch (command) {
    case 'add-user': {
      const nonFlagArgs = args.slice(1).filter(a => !a.startsWith('--'));
      const email = nonFlagArgs[0];
      const isAdmin = args.includes('--admin');
      await handleAddUser(email, isAdmin);
      break;
    }
    case 'list-users': {
      await handleListUsers();
      break;
    }
    case 'reset-cooldown': {
      await handleResetCooldown(args[1]);
      break;
    }
    default:
      printHelp();
      break;
  }
}

main();
