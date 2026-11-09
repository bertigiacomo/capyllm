import crypto from 'node:crypto';

/**
 * Returns the derived 32-byte AES key from CAPY_MASTER_KEY.
 */
export function getMasterKey(): Buffer {
  const envKey = process.env.CAPY_MASTER_KEY || 'default-capyllm-insecure-master-key-must-change-in-prod';
  return crypto.createHash('sha256').update(envKey).digest();
}

export interface DecryptResult {
  success: boolean;
  data?: string;
  error?: string;
}

/**
 * Encrypts plain text using AES-256-GCM AEAD.
 * Format: iv:tag:ciphertext (all base64url encoded).
 */
export function encryptSecret(plainText: string, masterKey?: Buffer): string {
  const key = masterKey || getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/**
 * Decrypts an AES-256-GCM AEAD encrypted string.
 * Gracefully handles decryption errors (corrupted tag, wrong key, bad format).
 */
export function decryptSecret(cipherString: string, masterKey?: Buffer): DecryptResult {
  try {
    if (!cipherString || typeof cipherString !== 'string') {
      return { success: false, error: 'Empty or invalid ciphertext provided' };
    }

    const parts = cipherString.split(':');
    if (parts.length !== 3) {
      return { success: false, error: 'Malformed ciphertext format (expected iv:tag:ciphertext)' };
    }

    const [ivB64, tagB64, cipherB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(cipherB64, 'base64url');

    if (iv.length !== 12) {
      return { success: false, error: `Invalid IV length: expected 12 bytes, got ${iv.length}` };
    }
    if (tag.length !== 16) {
      return { success: false, error: `Invalid auth tag length: expected 16 bytes, got ${tag.length}` };
    }

    const key = masterKey || getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { success: true, data: decrypted.toString('utf8') };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Decryption failed' };
  }
}

/**
 * Hashes a virtual key with SHA-256.
 */
export function hashVirtualKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export interface GeneratedVirtualKey {
  fullKey: string;
  keyPrefix: string;
  keyHash: string;
}

/**
 * Generates a client virtual key: capy_live_<random_prefix_6>_<secret>
 */
export function generateVirtualKey(): GeneratedVirtualKey {
  const prefix = crypto.randomBytes(3).toString('hex'); // 6 hex chars
  const secret = crypto.randomBytes(24).toString('hex'); // 48 clean hex chars
  const fullKey = `capy_live_${prefix}_${secret}`;
  const keyPrefix = `capy_live_${prefix}`;
  const keyHash = hashVirtualKey(fullKey);

  return {
    fullKey,
    keyPrefix,
    keyHash,
  };
}

/**
 * Redacts any sensitive API keys or credential patterns from error messages, logs, or payload snippets.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') return '';
  return message
    // Match common API key formats (OpenAI, Gemini, Groq, Mistral, Anthropic, Bearer tokens, hex strings)
    .replace(/(?:sk-[a-zA-Z0-9_-]{8,}|AIza[a-zA-Z0-9_-]{8,}|gsk_[a-zA-Z0-9_-]{8,}|capy_live_[a-zA-Z0-9_-]{8,}|Bearer\s+[a-zA-Z0-9_\-\.]{8,})/gi, '[RISERVATO]')
    // Match any remaining generic high-entropy key tokens
    .replace(/(?:key|token|secret)[:=\s]+["']?([a-zA-Z0-9_\-]{12,})["']?/gi, 'key: "[RISERVATO]"');
}

/**
 * Masks an API key for safe display. Completely conceals digits/characters to avoid leaking prefix/suffix.
 */
export function maskKey(key: string): string {
  if (!key) return '';
  return '••••••••••••';
}
