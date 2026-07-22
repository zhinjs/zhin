import { describe, expect, it, vi } from 'vitest';
import {
  IlinkQrLoginError,
  loginWithIlinkQr,
} from '../src/weixin-ilink-login.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function fetchSequence(steps: Array<Record<string, unknown>>): typeof fetch {
  let index = 0;
  return vi.fn(async () => {
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    return jsonResponse(step);
  }) as unknown as typeof fetch;
}

const noSleep = () => Promise.resolve();

describe('loginWithIlinkQr', () => {
  it('completes the QR flow and returns the bot token', async () => {
    const fetchImpl = fetchSequence([
      { qrcode: 'qr-id-1', qrcode_img_content: 'https://qr.example/abc' },
      { status: 'wait' },
      { status: 'scaned' },
      { status: 'confirmed', bot_token: 'tok-1', ilink_user_id: 'u-1', ilink_endpoint_id: 'b-1' },
    ]);
    const urls: string[] = [];
    const statuses: string[] = [];
    const result = await loginWithIlinkQr({
      fetchImpl,
      sleep: noSleep,
      onQrCode: (url) => { urls.push(url); },
      onStatus: (status) => { statuses.push(status); },
    });

    expect(urls).toEqual(['https://qr.example/abc']);
    expect(statuses).toContain('scaned');
    expect(result).toMatchObject({
      botToken: 'tok-1',
      ilinkUserId: 'u-1',
      ilinkBotId: 'b-1',
      baseUrl: 'https://ilinkai.weixin.qq.com',
    });
  });

  it('follows scaned_but_redirect to the redirect host', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('get_bot_qrcode')) {
        return jsonResponse({ qrcode: 'qr-2', qrcode_img_content: 'https://qr.example/def' });
      }
      if (url.startsWith('https://ilinkai.weixin.qq.com')) {
        return jsonResponse({ status: 'scaned_but_redirect', redirect_host: 'redirect.weixin.qq.com' });
      }
      return jsonResponse({ status: 'confirmed', bot_token: 'tok-2' });
    }) as unknown as typeof fetch;

    const result = await loginWithIlinkQr({ fetchImpl, sleep: noSleep, onQrCode: () => {} });
    expect(result.botToken).toBe('tok-2');
    expect(result.baseUrl).toBe('https://redirect.weixin.qq.com');
    expect(calls.some((url) => url.startsWith('https://redirect.weixin.qq.com'))).toBe(true);
  });

  it('throws expired reason when the QR code expires', async () => {
    const fetchImpl = fetchSequence([
      { qrcode: 'qr-3', qrcode_img_content: 'https://qr.example/ghi' },
      { status: 'expired' },
    ]);
    await expect(loginWithIlinkQr({ fetchImpl, sleep: noSleep, onQrCode: () => {} }))
      .rejects.toMatchObject({ name: 'IlinkQrLoginError', reason: 'expired' });
  });

  it('throws protocol reason when confirmed without bot_token', async () => {
    const fetchImpl = fetchSequence([
      { qrcode: 'qr-4', qrcode_img_content: 'https://qr.example/jkl' },
      { status: 'confirmed' },
    ]);
    await expect(loginWithIlinkQr({ fetchImpl, sleep: noSleep, onQrCode: () => {} }))
      .rejects.toMatchObject({ reason: 'protocol' });
  });

  it('throws timeout when the deadline passes without confirmation', async () => {
    const fetchImpl = fetchSequence([
      { qrcode: 'qr-5', qrcode_img_content: 'https://qr.example/mno' },
      { status: 'wait' },
    ]);
    await expect(loginWithIlinkQr({
      fetchImpl,
      sleep: noSleep,
      onQrCode: () => {},
      timeoutMs: 1,
    })).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('wraps QR fetch failures as network reason', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(loginWithIlinkQr({ fetchImpl, sleep: noSleep, onQrCode: () => {} }))
      .rejects.toBeInstanceOf(IlinkQrLoginError);
  });
});
