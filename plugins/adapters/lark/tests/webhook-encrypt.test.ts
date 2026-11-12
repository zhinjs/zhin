import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { webhookRequest } from '../../test-utils/http.js';
import { describe, expect, it, vi } from 'vitest';
import { decryptLarkEvent, resolveLarkConfig } from '../src/protocol.js';
import { handleLarkWebhookRequest } from '../src/webhook.js';

const ENCRYPT_KEY = 'fixture-encrypt-key';
const TOKEN = 'fixture-token';

/** Encrypt the way the open platform documents it: SHA-256 key, IV prefix, AES-256-CBC, PKCS#7. */
function encrypt(plain: string, encryptKey = ENCRYPT_KEY): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

function sign(body: string, timestamp: string, nonce: string, key = ENCRYPT_KEY): string {
  return createHash('sha256').update(`${timestamp}${nonce}${key}${body}`).digest('hex');
}

function createHandler(overrides: Parameters<typeof resolveLarkConfig>[0] | object = {}) {
  const config = resolveLarkConfig({
    id: 'bot', appId: 'fixture', appSecret: 'fixture', encryptKey: ENCRYPT_KEY, verificationToken: TOKEN, ...overrides,
  });
  return { config, isOpen: true, admit: vi.fn(), admitPlatform: vi.fn(), admitCardAction: vi.fn() };
}

async function post(
  handler: ReturnType<typeof createHandler>,
  body: string,
  options: { readonly signed?: boolean; readonly signature?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce';
  const headers: Record<string, string> = options.signed === false ? {} : {
    'x-lark-request-timestamp': timestamp,
    'x-lark-request-nonce': nonce,
    'x-lark-signature': options.signature ?? sign(body, timestamp, nonce),
  };
  const response = await handleLarkWebhookRequest(webhookRequest(body, headers), handler);
  const status = response.status;
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* plain text response */ }
  return { status, body: parsed };
}

describe('Lark encrypted webhook events', () => {
  it('decryptLarkEvent round-trips the documented AES-256-CBC envelope', () => {
    const plain = JSON.stringify({ type: 'url_verification', challenge: '挑战-1' });
    expect(decryptLarkEvent(ENCRYPT_KEY, encrypt(plain))).toBe(plain);
    expect(() => decryptLarkEvent('another-key', encrypt(plain))).toThrow();
    expect(() => decryptLarkEvent(ENCRYPT_KEY, 'AAAA')).toThrow('Malformed encrypted Lark event');
  });

  it('answers the URL-verification challenge carried in an encrypted body', async () => {
    const handler = createHandler();
    const body = JSON.stringify({ encrypt: encrypt(JSON.stringify({ type: 'url_verification', token: TOKEN, challenge: 'c-42' })) });
    expect(await post(handler, body)).toEqual({ status: 200, body: { challenge: 'c-42' } });
    expect(handler.admit).not.toHaveBeenCalled();
  });

  it('decrypts and admits a normal message event', async () => {
    const handler = createHandler();
    const message = {
      message_id: 'om_1', create_time: '1700000000000', chat_id: 'oc_group1', message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
    };
    const event = {
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1', token: TOKEN },
      event: { sender: { sender_id: { open_id: 'ou_user1' } }, message },
    };
    const result = await post(handler, JSON.stringify({ encrypt: encrypt(JSON.stringify(event)) }));
    expect(result).toEqual({ status: 200, body: { code: 0, msg: 'success' } });
    expect(handler.admit).toHaveBeenCalledWith(
      { ...message, sender: { sender_id: { open_id: 'ou_user1' } } },
      event,
    );
    expect(handler.admitPlatform).toHaveBeenCalledWith('event', event);
  });

  it('checks the verification token of the decrypted event, not of the envelope', async () => {
    const handler = createHandler();
    const body = JSON.stringify({ encrypt: encrypt(JSON.stringify({ type: 'url_verification', token: 'wrong', challenge: 'c' })) });
    expect((await post(handler, body)).status).toBe(403);
  });

  it('rejects an encrypted body whose signature does not match before decrypting', async () => {
    const handler = createHandler();
    const body = JSON.stringify({ encrypt: encrypt(JSON.stringify({ type: 'url_verification', token: TOKEN, challenge: 'c' })) });
    expect((await post(handler, body, { signature: 'bad' })).status).toBe(403);
    expect(handler.admitPlatform).not.toHaveBeenCalled();
  });

  it('answers 400 when the payload was encrypted with a different key', async () => {
    const handler = createHandler();
    const body = JSON.stringify({ encrypt: encrypt(JSON.stringify({ type: 'url_verification', token: TOKEN, challenge: 'c' }), 'other-key') });
    expect(await post(handler, body)).toEqual({ status: 400, body: { code: -1, msg: 'Decryption failed' } });
    expect(handler.admitPlatform).not.toHaveBeenCalled();
  });

  it('answers 400 instead of silently dropping an encrypted event when no encryptKey is configured', async () => {
    const handler = createHandler({ encryptKey: undefined });
    const body = JSON.stringify({ encrypt: encrypt(JSON.stringify({ type: 'url_verification', token: TOKEN, challenge: 'c' })) });
    expect(await post(handler, body, { signed: false })).toEqual({ status: 400, body: { code: -1, msg: 'Encrypt key is not configured' } });
  });

  it('still accepts a signed plaintext event when encryptKey is configured', async () => {
    const handler = createHandler();
    const body = JSON.stringify({ type: 'url_verification', token: TOKEN, challenge: 'plain' });
    expect(await post(handler, body)).toEqual({ status: 200, body: { challenge: 'plain' } });
  });
});
