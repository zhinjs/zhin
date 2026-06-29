import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Plugin } from 'zhin.js';
import { QQAdapter } from '../src/adapter.js';
import { QqEndpointManager, disposeQqEndpointProvision } from '../src/qq-endpoint-manager.js';
import * as qqBindFlow from '../src/qq-bind-flow.js';

describe('QqEndpointManager', () => {
  let root: Plugin;
  let plugin: Plugin;
  let adapter: QQAdapter;
  let manager: QqEndpointManager;
  let tmp: string;
  let prevRoot: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-mgr-'));
    prevRoot = process.env.ZHIN_PROJECT_ROOT;
    process.env.ZHIN_PROJECT_ROOT = tmp;
    root = new Plugin('/test/root.ts');
    plugin = new Plugin('/plugins/adapters/qq/src/index.ts', root);
    adapter = new QQAdapter(plugin);
    manager = new QqEndpointManager(adapter);
    disposeQqEndpointProvision();
  });

  afterEach(() => {
    disposeQqEndpointProvision();
    vi.clearAllMocks();
    if (prevRoot === undefined) delete process.env.ZHIN_PROJECT_ROOT;
    else process.env.ZHIN_PROJECT_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects concurrent addEndpoint', async () => {
    vi.spyOn(qqBindFlow, 'startQqBindFlow').mockReturnValue(() => {});
    const ctx = {
      message: { $raw: '/endpoint add qq' },
      root,
      onStatusUpdate: vi.fn(),
    } as never;
    void manager.addEndpoint(ctx);
    await expect(manager.addEndpoint(ctx)).rejects.toThrow(/已有进行中/);
  });

  it('cancelProvision clears active bind flow', () => {
    const stop = vi.fn();
    vi.spyOn(qqBindFlow, 'startQqBindFlow').mockReturnValue(stop);
    const ctx = {
      message: { $raw: '/endpoint add qq' },
      root,
      onStatusUpdate: vi.fn(),
    } as never;
    void manager.addEndpoint(ctx);
    expect(manager.cancelProvision()).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(manager.cancelProvision()).toBe(false);
  });

  it('addEndpoint resolves config on bind success', async () => {
    vi.spyOn(qqBindFlow, 'startQqBindFlow').mockImplementation((handlers) => {
      void handlers.onSuccess([{
        appId: '900000001',
        appSecret: 'mock-app-secret',
        userOpenId: 'MOCK_OPERATOR_OPENID',
      }]);
      return () => {};
    });
    root.provide({
      name: 'config',
      description: 'test config',
      value: {
        primaryFile: 'zhin.config.yml',
        getPrimary: () => ({ endpoints: [] }),
        getRaw: () => ({ endpoints: [] }),
      },
    });
    const ctx = {
      message: { $raw: '/endpoint add qq mybot', $sender: { id: 'fallback-id' } },
      root,
      onStatusUpdate: vi.fn(),
    } as never;
    const config = await manager.addEndpoint(ctx);
    expect(config).toMatchObject({
      context: 'qq',
      name: 'mybot',
      appid: '${QQ_MYBOT_APPID}',
      secret: '${QQ_MYBOT_SECRET}',
      master: 'MOCK_OPERATOR_OPENID',
      aiAccess: {
        mode: 'whitelist',
        users: ['MOCK_OPERATOR_OPENID'],
      },
    });
    expect(process.env.QQ_MYBOT_APPID).toBe('900000001');
    expect(process.env.QQ_MYBOT_SECRET).toBe('mock-app-secret');
  });

  it('addEndpoint clones qq template and uses bind user for master/aiAccess', async () => {
    const mockAppId = '900000002';
    const mockOperatorOpenId = 'MOCK_SCANNER_OPENID';
    vi.spyOn(qqBindFlow, 'startQqBindFlow').mockImplementation((handlers) => {
      void handlers.onSuccess([{
        appId: mockAppId,
        appSecret: 'mock-bound-secret',
        userOpenId: mockOperatorOpenId,
      }]);
      return () => {};
    });
    root.provide({
      name: 'config',
      description: 'test config',
      value: {
        primaryFile: 'zhin.config.yml',
        getRaw: () => ({
          endpoints: [{
            context: 'qq',
            name: 'zhin',
            appid: '${QQ_APPID}',
            secret: '${QQ_SECRET}',
            aiAccess: { mode: 'whitelist', users: ['u1'], groups: [] },
            intents: ['GUILDS', 'DIRECT_MESSAGE'],
          }],
        }),
      },
    });
    const ctx = {
      message: { $raw: '/endpoint add qq' },
      root,
      onStatusUpdate: vi.fn(),
    } as never;
    const config = await manager.addEndpoint(ctx);
    expect(config).toMatchObject({
      context: 'qq',
      name: mockAppId,
      appid: '${QQ_900000002_APPID}',
      secret: '${QQ_900000002_SECRET}',
      master: mockOperatorOpenId,
      aiAccess: {
        mode: 'whitelist',
        users: [mockOperatorOpenId],
        groups: [],
      },
    });
    expect(config.aiAccess).not.toBe(
      (root.inject('config') as { getRaw: () => { endpoints: Array<{ aiAccess: unknown }> } }).getRaw('zhin.config.yml').endpoints[0].aiAccess,
    );
  });
});
