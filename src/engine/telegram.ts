import { getDatabase, type TelegramSettings, type UpstreamKey, type VirtualKey } from '../db';
import { decryptSecret, encryptSecret } from '../crypto';

// In-memory cache for ultra-fast lookup (invalidated on settings update)
let cachedSettings: TelegramSettings | null = null;
let lastCooldownNotified = new Map<string, number>(); // keyId -> timestamp

export function clearTelegramCache(): void {
  cachedSettings = null;
}

export interface ResolvedTelegramConfig {
  isEnabled: boolean;
  botToken: string | null;
  chatId: string | null;
  notifyOnBudgetWarning: boolean;
  notifyOnBudgetExceeded: boolean;
  notifyOnKeyCooldown: boolean;
  notifyOnKeyError: boolean;
}

/**
 * Loads Telegram configuration from DB, falling back to process.env if present.
 */
export function getTelegramConfig(): ResolvedTelegramConfig {
  let dbRow: TelegramSettings | null = cachedSettings;

  if (!dbRow) {
    try {
      const db = getDatabase();
      dbRow = db.query('SELECT * FROM telegram_settings WHERE id = ?').get('default') as TelegramSettings | null;
      cachedSettings = dbRow;
    } catch {
      dbRow = null;
    }
  }

  let botToken: string | null = null;
  if (dbRow?.bot_token_encrypted) {
    const dec = decryptSecret(dbRow.bot_token_encrypted);
    if (dec.success && dec.data) {
      botToken = dec.data;
    }
  }

  // Fallback to environment variables
  if (!botToken && process.env.TELEGRAM_BOT_TOKEN) {
    botToken = process.env.TELEGRAM_BOT_TOKEN.trim();
  }

  const chatId = dbRow?.chat_id || process.env.TELEGRAM_CHAT_ID || null;
  const isEnabled = Boolean(
    dbRow
      ? dbRow.is_enabled === 1 && botToken && chatId
      : process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true' && botToken && chatId
  );

  return {
    isEnabled,
    botToken,
    chatId,
    notifyOnBudgetWarning: dbRow ? dbRow.notify_on_budget_warning === 1 : true,
    notifyOnBudgetExceeded: dbRow ? dbRow.notify_on_budget_exceeded === 1 : true,
    notifyOnKeyCooldown: dbRow ? dbRow.notify_on_key_cooldown === 1 : true,
    notifyOnKeyError: dbRow ? dbRow.notify_on_key_error === 1 : true,
  };
}

/**
 * Saves Telegram configuration into SQLite (encrypting bot token with AES-256-GCM).
 */
export function saveTelegramSettings(data: {
  is_enabled: boolean;
  bot_token?: string | null;
  chat_id: string;
  notify_on_budget_warning?: boolean;
  notify_on_budget_exceeded?: boolean;
  notify_on_key_cooldown?: boolean;
  notify_on_key_error?: boolean;
}): void {
  const db = getDatabase();
  const existing = db.query('SELECT * FROM telegram_settings WHERE id = ?').get('default') as TelegramSettings | null;
  const now = Date.now();

  let bot_token_encrypted = existing?.bot_token_encrypted || null;
  if (data.bot_token && data.bot_token.trim()) {
    bot_token_encrypted = encryptSecret(data.bot_token.trim());
  }

  const is_enabled = data.is_enabled ? 1 : 0;
  const chat_id = data.chat_id.trim();
  const notify_on_budget_warning = data.notify_on_budget_warning !== false ? 1 : 0;
  const notify_on_budget_exceeded = data.notify_on_budget_exceeded !== false ? 1 : 0;
  const notify_on_key_cooldown = data.notify_on_key_cooldown !== false ? 1 : 0;
  const notify_on_key_error = data.notify_on_key_error !== false ? 1 : 0;

  db.query(`
    INSERT INTO telegram_settings (
      id, is_enabled, bot_token_encrypted, chat_id,
      notify_on_budget_warning, notify_on_budget_exceeded,
      notify_on_key_cooldown, notify_on_key_error, created_at, updated_at
    ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      is_enabled = excluded.is_enabled,
      bot_token_encrypted = COALESCE(excluded.bot_token_encrypted, telegram_settings.bot_token_encrypted),
      chat_id = excluded.chat_id,
      notify_on_budget_warning = excluded.notify_on_budget_warning,
      notify_on_budget_exceeded = excluded.notify_on_budget_exceeded,
      notify_on_key_cooldown = excluded.notify_on_key_cooldown,
      notify_on_key_error = excluded.notify_on_key_error,
      updated_at = excluded.updated_at
  `).run(
    is_enabled,
    bot_token_encrypted,
    chat_id,
    notify_on_budget_warning,
    notify_on_budget_exceeded,
    notify_on_key_cooldown,
    notify_on_key_error,
    now,
    now
  );

  clearTelegramCache();
}

/**
 * Sends a raw message to Telegram Bot API.
 */
export async function sendTelegramRaw(
  botToken: string,
  chatId: string,
  textHtml: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: textHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errJson.description || `HTTP ${res.status}: Failed to deliver message`,
      };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Telegram connection timed out' };
  }
}

/**
 * Asynchronous notification for upstream key 429 rate limit / cooldown.
 * Debounced per key: at most 1 alert every 5 minutes.
 */
export function notifyKeyCooldownAsync(
  key: UpstreamKey,
  failCount: number,
  cooldownSecs: number,
  errorMsg?: string | null
): void {
  queueMicrotask(async () => {
    try {
      const config = getTelegramConfig();
      if (!config.isEnabled || !config.notifyOnKeyCooldown || !config.botToken || !config.chatId) {
        return;
      }

      // Debounce: 5 minutes between cooldown notifications for the same key
      const now = Date.now();
      const last = lastCooldownNotified.get(key.id) || 0;
      if (now - last < 5 * 60 * 1000) {
        return;
      }
      lastCooldownNotified.set(key.id, now);

      const html = `⏳ <b>CapyLLM: Upstream Key Rate-Limited (429)</b>\n\n` +
        `🔑 <b>Key:</b> ${escapeHtml(key.name)}\n` +
        `🏢 <b>Provider:</b> <code>${escapeHtml(key.provider)}</code>\n` +
        `❄️ <b>Cooldown:</b> ${cooldownSecs}s (Fail #${failCount})\n` +
        `🔄 <b>Auto-Failover:</b> Request immediately rerouted to next available key.\n` +
        (errorMsg ? `⚠️ <i>${escapeHtml(errorMsg)}</i>\n` : '');

      await sendTelegramRaw(config.botToken, config.chatId, html);
    } catch (err) {
      console.error('[CapyLLM Telegram Notification Error]:', err);
    }
  });
}

/**
 * Notification when a CapyKey reaches 80% of its budget limit.
 * Debounced: triggers at most once per reset cycle.
 */
export function notifyBudgetWarningAsync(
  vk: VirtualKey,
  currentSpend: number,
  budgetLimit: number,
  unit: 'tokens' | 'usd',
  cadence: string
): void {
  queueMicrotask(async () => {
    try {
      const config = getTelegramConfig();
      if (!config.isEnabled || !config.notifyOnBudgetWarning || !config.botToken || !config.chatId) {
        return;
      }

      const db = getDatabase();
      const now = Date.now();
      const pct = Math.round((currentSpend / budgetLimit) * 100);

      // Check if already notified for this cycle
      const row = db.query('SELECT last_budget_warning_at, spend_reset_at FROM virtual_keys WHERE id = ?').get(vk.id) as any;
      if (row?.last_budget_warning_at && row.last_budget_warning_at > (row.spend_reset_at ? row.spend_reset_at - 30 * 86400000 : 0)) {
        // Already warned within this budget period
        return;
      }

      db.query('UPDATE virtual_keys SET last_budget_warning_at = ?, updated_at = ? WHERE id = ?').run(now, now, vk.id);

      const formattedCurrent = unit === 'tokens' ? `${currentSpend.toLocaleString()} tokens` : `$${currentSpend.toFixed(2)}`;
      const formattedLimit = unit === 'tokens' ? `${budgetLimit.toLocaleString()} tokens` : `$${budgetLimit.toFixed(2)}`;

      const html = `⚠️ <b>CapyLLM: Budget Warning (≥ 80%)</b>\n\n` +
        `🔑 <b>CapyKey:</b> ${escapeHtml(vk.name)} (<code>${escapeHtml(vk.key_prefix)}</code>)\n` +
        `📊 <b>Usage:</b> ${formattedCurrent} of ${formattedLimit} (${cadence})\n` +
        `📈 <b>Capacity:</b> ${pct}% consumed.\n` +
        `💡 <i>CapyLLM will enforce a hard-stop once 100% is reached.</i>`;

      await sendTelegramRaw(config.botToken, config.chatId, html);
    } catch (err) {
      console.error('[CapyLLM Telegram Notification Error]:', err);
    }
  });
}

/**
 * Notification when a CapyKey reaches 100% of its budget limit (hard-stop triggered).
 * Debounced: triggers at most once per reset cycle.
 */
export function notifyBudgetExceededAsync(
  vk: VirtualKey,
  currentSpend: number,
  budgetLimit: number,
  unit: 'tokens' | 'usd',
  cadence: string
): void {
  queueMicrotask(async () => {
    try {
      const config = getTelegramConfig();
      if (!config.isEnabled || !config.notifyOnBudgetExceeded || !config.botToken || !config.chatId) {
        return;
      }

      const db = getDatabase();
      const now = Date.now();

      // Check if already notified for this cycle
      const row = db.query('SELECT last_budget_exceeded_at FROM virtual_keys WHERE id = ?').get(vk.id) as any;
      if (row?.last_budget_exceeded_at && (now - row.last_budget_exceeded_at < 3600_000)) {
        // Throttle hard stop alert to once per hour if requests continue bombarding
        return;
      }

      db.query('UPDATE virtual_keys SET last_budget_exceeded_at = ?, updated_at = ? WHERE id = ?').run(now, now, vk.id);

      const formattedCurrent = unit === 'tokens' ? `${currentSpend.toLocaleString()} tokens` : `$${currentSpend.toFixed(2)}`;
      const formattedLimit = unit === 'tokens' ? `${budgetLimit.toLocaleString()} tokens` : `$${budgetLimit.toFixed(2)}`;

      const html = `🚨 <b>CapyLLM: Budget Limit Exceeded (Hard Stop)</b>\n\n` +
        `🔑 <b>CapyKey:</b> ${escapeHtml(vk.name)} (<code>${escapeHtml(vk.key_prefix)}</code>)\n` +
        `🛑 <b>Status:</b> All subsequent client requests blocked with HTTP 429.\n` +
        `📊 <b>Consumed:</b> ${formattedCurrent} / ${formattedLimit} (${cadence})\n` +
        `🔄 <b>Reset:</b> ${cadence === 'one-shot' ? 'Lifetime grant (Manual reset required)' : 'Automatic at next cycle'}.`;

      await sendTelegramRaw(config.botToken, config.chatId, html);
    } catch (err) {
      console.error('[CapyLLM Telegram Notification Error]:', err);
    }
  });
}

/**
 * Notification when an Upstream Key reaches its daily token limit.
 */
export function notifyUpstreamKeyDailyLimitReachedAsync(
  key: UpstreamKey,
  currentTokens: number,
  limit: number
): void {
  queueMicrotask(async () => {
    try {
      const config = getTelegramConfig();
      if (!config.isEnabled || !config.botToken || !config.chatId || !config.notifyOnBudgetExceeded) {
        return;
      }

      const html = `🚨 <b>CapyLLM: Upstream Daily Token Limit Reached</b>\n\n` +
        `🔌 <b>Provider Key:</b> ${escapeHtml(key.name)} (<code>${escapeHtml(key.provider)}</code>)\n` +
        `🛑 <b>Status:</b> Key paused until next daily reset.\n` +
        `📊 <b>Usage:</b> ${currentTokens.toLocaleString()} / ${limit.toLocaleString()} tokens today\n` +
        `🔄 <b>Reset:</b> Automatic at 00:00 UTC (daily reset).`;

      await sendTelegramRaw(config.botToken, config.chatId, html);
    } catch (err) {
      console.error('[CapyLLM Telegram Notification Error]:', err);
    }
  });
}

/**
 * Test message sent to verify Telegram connection.
 */
export async function testTelegramWebhook(
  overrideToken?: string,
  overrideChatId?: string
): Promise<{ success: boolean; message: string }> {
  const config = getTelegramConfig();
  const token = overrideToken || config.botToken;
  const chatId = overrideChatId || config.chatId;

  if (!token || !chatId) {
    return {
      success: false,
      message: 'Both Bot Token and Chat ID are required to send a test message',
    };
  }

  const html = `🦫 <b>CapyLLM: Telegram Webhook Connected!</b>\n\n` +
    `✅ Your CapyLLM AI Gateway is successfully linked to Telegram.\n` +
    `⚡ <i>You will receive instant alerts for rate limits (429 cooldowns), budget warnings (80%), and hard stops (100%).</i>\n\n` +
    `🕒 <i>Timestamp: ${new Date().toISOString()}</i>`;

  const res = await sendTelegramRaw(token, chatId, html);
  if (!res.success) {
    return {
      success: false,
      message: res.error || 'Failed to send test message to Telegram',
    };
  }

  return {
    success: true,
    message: 'Test message sent successfully to Telegram!',
  };
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
