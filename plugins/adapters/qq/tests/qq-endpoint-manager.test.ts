import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Plugin } from 'zhin.js';
import { QQAdapter } from '../src/adapter.js';
import { QqEndpointManager, disposeQqEndpointProvision } from '../src/qq-endpoint-manager.js';
import * as qqBindFlow from '../src/qq-bind-flow.js';

describe('QqEndpointManager', () => {
  let root: Plugin;
  let plugin: Plugin;
  let adapter: QQAdapter;
  let manager: QqEndpointManager;

  beforeEach(() => {
    root = new Plugin('/test/root.ts');
    plugin = new Plugin('/plugins/adapters/qq/src/index.ts', root);
    adapter = new QQAdapter(plugin);
    manager = new QqEndpointManager(adapter);
    disposeQqEndpointProvision();
  });

  afterEach(() => {
    disposeQqEndpointProvision();
    vi.clearAllMocks();
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
      void handlers.onSuccess([{ appId: '102086000', appSecret: 'secret' }]);
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
      message: { $raw: '/endpoint add qq mybot' },
      root,
      onStatusUpdate: vi.fn(),
    } as never;
    const config = await manager.addEndpoint(ctx);
    expect(config).toMatchObject({
      context: 'qq',
      name: 'mybot',
      appid: '102086000',
      secret: 'secret',
    });
  });
});
