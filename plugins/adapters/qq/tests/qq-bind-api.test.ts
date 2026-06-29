import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  BindStatus,
  buildConnectUrl,
  decryptSecret,
  generateBindKey,
} from '../src/qq-bind-api.js';

describe('qq-bind-api', () => {
  it('generateBindKey returns 32-byte base64', () => {
    const key = generateBindKey();
    expect(Buffer.from(key, 'base64').length).toBe(32);
  });

  it('buildConnectUrl encodes task and source', () => {
    const url = buildConnectUrl('task-123', 'zhin');
    expect(url).toContain('task_id=task-123');
    expect(url).toContain('source=zhin');
    expect(url).toMatch(/^https:\/\/q\.qq\.com\//);
  });

  it('decryptSecret reverses AES-256-GCM payload', () => {
    const keyBase64 = generateBindKey();
    const key = Buffer.from(keyBase64, 'base64');
    const iv = randomBytes(12);
    const plaintext = 'test-app-secret-value';
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, encrypted, authTag]).toString('base64');
    expect(decryptSecret(payload, keyBase64)).toBe(plaintext);
  });

  it('parsePollBindResultData reads user_openid', async () => {
    const { parsePollBindResultData, BindStatus } = await import('../src/qq-bind-api.js');
    const parsed = parsePollBindResultData({
      status: BindStatus.COMPLETED,
      bot_appid: '900000001',
      bot_encrypt_secret: 'mock-encrypted',
      user_openid: 'MOCK_OPERATOR_OPENID',
    });
    expect(parsed.userOpenId).toBe('MOCK_OPERATOR_OPENID');
  });
});
