import { describe, it, expect } from 'bun:test';
import {
  getMasterKey,
  encryptSecret,
  decryptSecret,
  generateVirtualKey,
  hashVirtualKey,
  maskKey,
  sanitizeErrorMessage,
} from '../src/crypto';

describe('Crypto module', () => {
  it('derives a consistent 32-byte master key', () => {
    const key1 = getMasterKey();
    const key2 = getMasterKey();
    expect(key1.length).toBe(32);
    expect(key1.equals(key2)).toBe(true);
  });

  it('encrypts and decrypts secrets with AES-256-GCM', () => {
    const original = 'sk-proj-super-secret-api-key-1234567890';
    const encrypted = encryptSecret(original);

    // format iv:tag:ciphertext base64url
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted.success).toBe(true);
    expect(decrypted.data).toBe(original);
  });

  it('handles decryption errors gracefully on corrupt ciphertext', () => {
    const original = 'secret-payload';
    const encrypted = encryptSecret(original);
    const parts = encrypted.split(':');

    // Corrupt tag
    const corruptTag = 'xxxx' + parts[1].slice(4);
    const corrupted = `${parts[0]}:${corruptTag}:${parts[2]}`;

    const res = decryptSecret(corrupted);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('handles decryption errors gracefully on malformed string', () => {
    const res = decryptSecret('invalid-cipher-string');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Malformed');
  });

  it('generates virtual keys in format capy_live_<prefix_6>_<secret>', () => {
    const vk = generateVirtualKey();
    expect(vk.fullKey.startsWith('capy_live_')).toBe(true);
    const parts = vk.fullKey.split('_');
    expect(parts.length).toBe(4); // ['capy', 'live', prefix, secret]
    expect(parts[2].length).toBe(6);
    expect(vk.keyPrefix).toBe(`capy_live_${parts[2]}`);
    expect(vk.keyHash).toBe(hashVirtualKey(vk.fullKey));
    expect(vk.keyHash.length).toBe(64); // SHA-256 hex
  });

  it('masks upstream keys correctly without revealing digits or prefixes/suffixes', () => {
    expect(maskKey('sk-1234567890abcdef')).toBe('••••••••••••');
    expect(maskKey('short')).toBe('••••••••••••');
  });

  it('sanitizes sensitive API keys and secrets from error messages', () => {
    const leakedMsg = 'Incorrect API key provided: sk-proj-1234567890abcdef1234. Visit platform.openai.com';
    expect(sanitizeErrorMessage(leakedMsg)).not.toContain('sk-proj-');
    expect(sanitizeErrorMessage(leakedMsg)).toContain('[RISERVATO]');
  });
});
