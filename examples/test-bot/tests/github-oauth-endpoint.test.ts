import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  verifyAuth: vi.fn(),
  requestCode: vi.fn(),
  pollToken: vi.fn(),
}));

vi.mock('@zhin.js/adapter-github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zhin.js/adapter-github')>();
  class MockGhClient {
    static deviceFlowRequestCode = mocks.requestCode;
    static deviceFlowPollToken = mocks.pollToken;

    constructor(options: unknown) {
      mocks.construct(options);
    }

    verifyAuth = mocks.verifyAuth;
  }
  return { ...actual, GhClient: MockGhClient };
});

import {
  bindWithPat,
  startDeviceFlowBind,
  whoamiOauth,
} from '../lib/github-oauth.js';

function modelWithRows(rows: unknown[]) {
  return {
    select: vi.fn(() => ({ where: vi.fn(async () => rows) })),
    insert: vi.fn(async () => undefined),
  };
}

describe('test-bot GitHub OAuth endpoint access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the generation-bound endpoint host for PAT verification', async () => {
    const model = modelWithRows([]);
    mocks.verifyAuth.mockResolvedValueOnce({ ok: true, user: 'alice' });
    const endpoint = { host: 'https://github.example' };

    await expect(bindWithPat(endpoint as never, model as never, 'icqq', '10001', 'token'))
      .resolves.toBe('GitHub 绑定成功\n用户: alice');
    expect(mocks.construct).toHaveBeenCalledWith({ host: endpoint.host, token: 'token' });
    expect(model.insert).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'icqq',
      platform_uid: '10001',
      github_login: 'alice',
      access_token: 'token',
    }));
  });

  it('uses the generation-bound endpoint client id and host for Device Flow', async () => {
    const model = modelWithRows([]);
    mocks.requestCode.mockResolvedValueOnce({
      device_code: 'device',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    });
    mocks.pollToken.mockResolvedValueOnce(null);
    const endpoint = { clientId: 'client-id', host: 'https://github.example' };

    await expect(startDeviceFlowBind(endpoint as never, model as never, 'icqq', '10001'))
      .resolves.toContain('ABCD-EFGH');
    expect(mocks.requestCode).toHaveBeenCalledWith('client-id', endpoint.host);
    expect(mocks.pollToken).toHaveBeenCalledWith('client-id', 'device', 5, 900, endpoint.host);
  });

  it('uses endpoint API and host when reporting a bound identity', async () => {
    const model = modelWithRows([{
      id: 1,
      platform: 'icqq',
      platform_uid: '10001',
      github_login: 'alice',
      access_token: 'user-token',
      created_at: 1,
    }]);
    const endpoint = {
      host: 'https://github.example',
      api: { verifyAuth: vi.fn(async () => ({ ok: true, user: 'bot' })) },
    };
    mocks.verifyAuth.mockResolvedValueOnce({ ok: false, message: 'expired' });

    await expect(whoamiOauth(endpoint as never, model as never, 'icqq', '10001'))
      .resolves.toContain('Token 已失效');
    expect(endpoint.api.verifyAuth).toHaveBeenCalledOnce();
    expect(mocks.construct).toHaveBeenCalledWith({ host: endpoint.host, token: 'user-token' });
  });
});
