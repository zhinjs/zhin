import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/credentials.js', () => ({
  loadCredentials: vi.fn(() => null),
  saveCredentials: vi.fn(),
}));

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

import { loadCredentials, saveCredentials } from '../src/credentials.js';
import { apiGetFetch, apiPostFetch } from '../src/ilink-api.js';
import { resolveCredentials } from '../src/login.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';

const mockedLoadCredentials = vi.mocked(loadCredentials);
const mockedSaveCredentials = vi.mocked(saveCredentials);
const mockedApiGetFetch = vi.mocked(apiGetFetch);
const mockedApiPostFetch = vi.mocked(apiPostFetch);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WEIXIN_ILINK_TOKEN', '');
  mockedLoadCredentials.mockReturnValue(null);
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

describe('weixin-ilink login fallback (no botToken)', () => {
  it('resolveWeixinIlinkConfig does not throw without botToken', () => {
    const resolved = resolveWeixinIlinkConfig({ name: 'no-token-bot' });
    expect(resolved.botToken).toBeFalsy();
    expect(resolved.name).toBe('no-token-bot');
  });

  it('falls back to sidecar credentials when no config/env token', async () => {
    mockedLoadCredentials.mockReturnValue({
      botToken: 'sidecar-token',
      ilinkUserId: 'u-sidecar',
    });
    const config = resolveWeixinIlinkConfig({ name: 'sidecar-bot' });
    const creds = await resolveCredentials(config);
    expect(creds.botToken).toBe('sidecar-token');
    expect(mockedApiPostFetch).not.toHaveBeenCalled();
  });

  it('falls back to QR login when no token anywhere (network mocked)', async () => {
    delete process.env.WEIXIN_ILINK_TOKEN;
    const config = resolveWeixinIlinkConfig({ name: 'qr-bot' });
    const creds = await resolveCredentials(config);
    expect(creds.botToken).toBe('qr-token');
    expect(creds.ilinkUserId).toBe('user-1');
    expect(mockedApiPostFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiGetFetch).toHaveBeenCalled();
    expect(mockedSaveCredentials).toHaveBeenCalledWith('qr-bot', expect.objectContaining({
      botToken: 'qr-token',
    }));
  });
});
