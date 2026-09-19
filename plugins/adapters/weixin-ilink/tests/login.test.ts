import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ilink-api.js', () => ({
  apiPostFetch: vi.fn(async () => JSON.stringify({
    qrcode: 'qr-1',
    qrcode_img_content: 'https://qr.mock/qr-1',
  })),
  apiGetFetch: vi.fn(async () => JSON.stringify({
    status: 'confirmed',
    bot_token: 'qr-token',
    ilink_user_id: 'user-1',
    ilink_endpoint_id: 'bot-1',
    baseurl: 'https://ilink.mock',
  })),
}));

import { WeixinIlinkStateStore } from '../src/credentials.js';
import { apiGetFetch, apiPostFetch } from '../src/ilink-api.js';
import { IlinkClientMetadata } from '../src/ilink-meta.js';
import { resolveCredentials } from '../src/login.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';

const mockedApiGetFetch = vi.mocked(apiGetFetch);
const mockedApiPostFetch = vi.mocked(apiPostFetch);
const metadata = new IlinkClientMetadata({ version: '1.2.3' });
let dataDir: string;

function state(endpointId: string): WeixinIlinkStateStore {
  return new WeixinIlinkStateStore(endpointId, dataDir);
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-ilink-login-'));
  vi.clearAllMocks();
  mockedApiPostFetch.mockResolvedValue(JSON.stringify({
    qrcode: 'qr-1',
    qrcode_img_content: 'https://qr.mock/qr-1',
  }));
  mockedApiGetFetch.mockResolvedValue(JSON.stringify({
    status: 'confirmed',
    bot_token: 'qr-token',
    ilink_user_id: 'user-1',
    ilink_endpoint_id: 'bot-1',
    baseurl: 'https://ilink.mock',
  }));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('weixin-ilink login fallback (no botToken)', () => {
  it('resolveWeixinIlinkConfig does not throw without botToken', () => {
    const resolved = resolveWeixinIlinkConfig({ id: 'no-token-bot' });
    expect(resolved.botToken).toBeFalsy();
    expect(resolved.id).toBe('no-token-bot');
  });

  it('falls back to endpoint-owned credentials when no configured token', async () => {
    const store = state('sidecar-bot');
    store.saveCredentials({
      botToken: 'sidecar-token',
      ilinkUserId: 'u-sidecar',
    });
    const config = resolveWeixinIlinkConfig({ id: 'sidecar-bot', dataDir });
    const creds = await resolveCredentials(config, metadata, store);
    expect(creds.botToken).toBe('sidecar-token');
    expect(mockedApiPostFetch).not.toHaveBeenCalled();
  });

  it('falls back to QR login when no token anywhere (network mocked)', async () => {
    const store = state('qr-bot');
    const config = resolveWeixinIlinkConfig({ id: 'qr-bot', dataDir });
    const creds = await resolveCredentials(config, metadata, store);
    expect(creds.botToken).toBe('qr-token');
    expect(creds.ilinkUserId).toBe('user-1');
    expect(mockedApiPostFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiGetFetch).toHaveBeenCalled();
    expect(store.loadCredentials()).toMatchObject({ botToken: 'qr-token' });
  });

  it('QR 登录循环响应 AbortSignal（stop 后不再跑满 8 分钟）', async () => {
    // 一直 wait：不 abort 就要跑到 8 分钟超时
    mockedApiGetFetch.mockResolvedValue(JSON.stringify({ status: 'wait' }));
    const store = state('qr-abort-bot');
    const config = resolveWeixinIlinkConfig({ id: 'qr-abort-bot', dataDir });
    const abort = new AbortController();
    const started = Date.now();
    const promise = resolveCredentials(config, metadata, store, abort.signal);
    setTimeout(() => abort.abort(), 50);
    await expect(promise).rejects.toThrow('扫码登录已取消');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
