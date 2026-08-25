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
  unbindOauth,
  whoamiOauth,
} from '../lib/github-oauth.js';

function modelWithRows(rows: unknown[]) {
  const deleteWhere = vi.fn(async () => undefined);
  return {
    select: vi.fn(() => ({ where: vi.fn(async () => rows) })),
    insert: vi.fn(async () => undefined),
    delete: vi.fn(() => ({ where: deleteWhere })),
    deleteWhere,
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

  it('preserves existing bindings and reports PAT verification failures', async () => {
    const existing = modelWithRows([{
      id: 1,
      platform: 'icqq',
      platform_uid: '10001',
      github_login: 'alice',
      access_token: 'old-token',
      created_at: 1,
    }]);
    await expect(bindWithPat({ host: 'https://github.example' } as never, existing as never,
      'icqq', '10001', 'new-token'))
      .resolves.toContain('请先执行 gh unbind');
    expect(mocks.construct).not.toHaveBeenCalled();

    const invalid = modelWithRows([]);
    mocks.verifyAuth.mockResolvedValueOnce({ ok: false, message: 'bad credentials' });
    await expect(bindWithPat({ host: 'https://github.example' } as never, invalid as never,
      'icqq', '10001', 'bad-token'))
      .resolves.toBe('Token 验证失败: bad credentials');
    expect(invalid.insert).not.toHaveBeenCalled();
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

  it('persists and announces a completed Device Flow binding', async () => {
    const model = modelWithRows([]);
    const reply = vi.fn(async () => undefined);
    mocks.requestCode.mockResolvedValueOnce({
      device_code: 'device',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    });
    mocks.pollToken.mockResolvedValueOnce({ access_token: 'device-token' });
    mocks.verifyAuth.mockResolvedValueOnce({ ok: true, user: 'alice' });
    const endpoint = { clientId: 'client-id', host: 'https://github.example' };

    await startDeviceFlowBind(endpoint as never, model as never, 'icqq', '10001', reply);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith('GitHub 绑定成功\n用户: alice'));
    expect(model.insert).toHaveBeenCalledWith(expect.objectContaining({
      github_login: 'alice',
      access_token: 'device-token',
    }));
  });

  it('reports missing Device Flow configuration and request failures', async () => {
    const model = modelWithRows([]);
    await expect(startDeviceFlowBind({ clientId: '', host: 'https://github.example' } as never,
      model as never, 'icqq', '10001'))
      .resolves.toContain('App 未配置 client_id');

    mocks.requestCode.mockRejectedValueOnce(new Error('device endpoint offline'));
    await expect(startDeviceFlowBind({ clientId: 'client-id', host: 'https://github.example' } as never,
      model as never, 'icqq', '10001'))
      .resolves.toContain('device endpoint offline');

    const existing = modelWithRows([{
      id: 1,
      platform: 'icqq',
      platform_uid: '10001',
      github_login: 'alice',
      access_token: 'old-token',
      created_at: 1,
    }]);
    await expect(startDeviceFlowBind({ clientId: 'client-id', host: 'https://github.example' } as never,
      existing as never, 'icqq', '10001'))
      .resolves.toContain('请先执行 gh unbind');
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

  it('reports unbound and valid identities, then removes the binding', async () => {
    const endpoint = {
      host: 'https://github.example',
      api: { verifyAuth: vi.fn(async () => ({ ok: false, message: 'app token missing' })) },
    };
    const unbound = modelWithRows([]);
    await expect(whoamiOauth(endpoint as never, unbound as never, 'icqq', '10001'))
      .resolves.toContain('用户绑定: 无');
    await expect(unbindOauth(unbound as never, 'icqq', '10001'))
      .resolves.toBe('尚未绑定 GitHub 账号');

    const bound = modelWithRows([{
      id: 7,
      platform: 'icqq',
      platform_uid: '10001',
      github_login: 'alice',
      access_token: 'user-token',
      created_at: 1,
    }]);
    mocks.verifyAuth.mockResolvedValueOnce({ ok: true, user: 'alice' });
    await expect(whoamiOauth(endpoint as never, bound as never, 'icqq', '10001'))
      .resolves.toContain('用户绑定: alice');
    await expect(unbindOauth(bound as never, 'icqq', '10001'))
      .resolves.toBe('已解绑: alice');
    expect(bound.deleteWhere).toHaveBeenCalledWith({ id: 7 });
  });
});
