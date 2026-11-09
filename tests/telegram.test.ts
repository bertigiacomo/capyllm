import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { app } from '../src/index';
import { initDatabase } from '../src/db';
import { setSessionCookie } from '../src/auth/session';
import { Hono } from 'hono';
import {
  getTelegramConfig,
  saveTelegramSettings,
  sendTelegramRaw,
  testTelegramWebhook,
  clearTelegramCache,
  notifyKeyCooldownAsync,
  notifyBudgetWarningAsync,
  notifyBudgetExceededAsync,
} from '../src/engine/telegram';
import { generateVirtualKey } from '../src/crypto';

async function createAdminCookie(): Promise<string> {
  const dummyApp = new Hono();
  dummyApp.get('/test-session', async (c) => {
    await setSessionCookie(c, {
      userId: 'u-admin-tg',
      email: 'admin@capyllm.ai',
      role: 'admin',
      createdAt: Date.now(),
    });
    return c.text('ok');
  });

  const res = await dummyApp.request('/test-session');
  return res.headers.get('set-cookie') || '';
}

describe('Telegram Webhook Notifications', () => {
  let db: any;
  let adminCookie: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    db = initDatabase(':memory:');
    clearTelegramCache();
    adminCookie = await createAdminCookie();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('saves Telegram settings and encrypts bot token at rest in SQLite', () => {
    saveTelegramSettings({
      is_enabled: true,
      bot_token: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
      chat_id: '987654321',
      notify_on_budget_warning: true,
      notify_on_budget_exceeded: true,
      notify_on_key_cooldown: true,
      notify_on_key_error: false,
    });

    // Check DB row directly: bot token must NOT be plaintext!
    const row = db.query('SELECT * FROM telegram_settings WHERE id = ?').get('default') as any;
    expect(row).toBeDefined();
    expect(row.is_enabled).toBe(1);
    expect(row.chat_id).toBe('987654321');
    expect(row.bot_token_encrypted).not.toBe('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    expect(row.bot_token_encrypted).toContain(':'); // iv:tag:ciphertext format

    // getTelegramConfig must transparently decrypt it
    const config = getTelegramConfig();
    expect(config.isEnabled).toBe(true);
    expect(config.botToken).toBe('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    expect(config.chatId).toBe('987654321');
    expect(config.notifyOnKeyError).toBe(false);
  });

  it('sends test message to Telegram Bot API with HTML parse mode', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url.toString();
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await testTelegramWebhook('mock-token-xyz', 'chat-id-123');
    expect(res.success).toBe(true);
    expect(capturedUrl).toBe('https://api.telegram.org/botmock-token-xyz/sendMessage');
    expect(capturedBody.chat_id).toBe('chat-id-123');
    expect(capturedBody.parse_mode).toBe('HTML');
    expect(capturedBody.text).toContain('CapyLLM: Telegram Webhook Connected!');
  });

  it('sends key cooldown alert on HTTP 429 and debounces duplicates', async () => {
    saveTelegramSettings({
      is_enabled: true,
      bot_token: 'mock-bot-token',
      chat_id: 'chat-456',
      notify_on_key_cooldown: true,
    });

    let callsCount = 0;
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init: any) => {
      callsCount++;
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const mockKey: any = {
      id: 'k-upstream-1',
      name: 'OpenAI Primary Tier 4',
      provider: 'openai',
    };

    // First trigger
    notifyKeyCooldownAsync(mockKey, 1, 60, 'Rate limited (HTTP 429)');
    await Bun.sleep(50); // wait for queueMicrotask

    expect(callsCount).toBe(1);
    expect(capturedBody.text).toContain('Upstream Key Rate-Limited (429)');
    expect(capturedBody.text).toContain('OpenAI Primary Tier 4');
    expect(capturedBody.text).toContain('60s');

    // Immediate second trigger on same key must be debounced
    notifyKeyCooldownAsync(mockKey, 2, 120, 'Rate limited (HTTP 429)');
    await Bun.sleep(50);
    expect(callsCount).toBe(1); // Still 1, debounced!
  });

  it('sends budget exceeded alert when CapyKey hits hard-stop cap', async () => {
    saveTelegramSettings({
      is_enabled: true,
      bot_token: 'mock-bot-token',
      chat_id: 'chat-456',
      notify_on_budget_exceeded: true,
    });

    let capturedBody: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    const now = Date.now();
    const vk = generateVirtualKey();
    db.query(`
      INSERT INTO virtual_keys (
        id, name, key_hash, key_prefix, rate_limit_rpm, budget_type,
        budget_cadence, budget_limit, current_spend_usd, current_spend_tokens,
        spend_reset_at, is_active, created_at, updated_at
      ) VALUES ('vk-alert-1', 'Frontier Bot Key', ?, ?, 0, 'tokens', 'daily', 250000, 0, 250000, ?, 1, ?, ?)
    `).run(vk.keyHash, vk.keyPrefix, now + 86400000, now, now);

    const vkRow = db.query('SELECT * FROM virtual_keys WHERE id = ?').get('vk-alert-1') as any;

    notifyBudgetExceededAsync(vkRow, 250000, 250000, 'tokens', 'daily');
    await Bun.sleep(50);

    expect(capturedBody).toBeDefined();
    expect(capturedBody.text).toContain('Budget Limit Exceeded (Hard Stop)');
    expect(capturedBody.text).toContain('Frontier Bot Key');
    expect(capturedBody.text).toContain('250,000 tokens / 250,000 tokens');
    expect(capturedBody.text).toContain('daily');
  });

  it('handles Telegram API error responses gracefully without crashing', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), {
        status: 403,
      });
    }) as any;

    const res = await sendTelegramRaw('bad-token', '123', 'test');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Forbidden');
  });

  it('provides admin endpoints to view, update and test Telegram webhook', async () => {
    // 1. Initial GET - not enabled yet
    const getRes1 = await app.request('/api/admin/telegram', {
      headers: { 'Cookie': adminCookie },
    });
    expect(getRes1.status).toBe(200);
    const json1 = await getRes1.json();
    expect(json1.is_enabled).toBe(false);
    expect(json1.has_bot_token).toBe(false);

    // 2. POST update settings
    const postRes = await app.request('/api/admin/telegram', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        is_enabled: true,
        bot_token: 'bot-secret-xyz',
        chat_id: '12345678',
        notify_on_budget_warning: true,
        notify_on_budget_exceeded: true,
        notify_on_key_cooldown: true,
        notify_on_key_error: true,
      }),
    });

    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.success).toBe(true);
    expect(postJson.settings.is_enabled).toBe(true);
    expect(postJson.settings.has_bot_token).toBe(true);
    expect(postJson.settings.chat_id).toBe('12345678');
    // Token plaintext must never be returned
    expect((postJson.settings as any).bot_token).toBeUndefined();

    // 3. Test Telegram Webhook endpoint
    globalThis.fetch = (async (url: any, init: any) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const testRes = await app.request('/api/admin/telegram/test', {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(testRes.status).toBe(200);
    const testJson = await testRes.json();
    expect(testJson.success).toBe(true);
    expect(testJson.message).toContain('Telegram');
  });
});
