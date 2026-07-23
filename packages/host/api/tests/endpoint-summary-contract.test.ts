import { describe, expect, it } from 'vitest';
import { Adapter, Plugin } from '@zhin.js/core';
import { handleCoreRpc } from '../src/rpc/handlers-core.js';
import type { ConsoleRpcContext } from '../src/rpc/context.js';

function createContext(): {
  ctx: ConsoleRpcContext;
  emitted: Record<string, unknown>[];
} {
  const root = new Plugin('/test/root.ts');
  const plugin = new Plugin('/test/plugin.ts', root);
  class TestAdapter extends Adapter {
    constructor() {
      super(plugin, 'test-adapter' as keyof Plugin.Contexts, []);
      this.endpoints.set('bot-1', {
        $connected: true,
        management: {
          async listFriends() { return []; },
          async listGroups() { return []; },
          async kickGroupMember() {},
        },
      } as never);
    }
  }
  const adapter = new TestAdapter();
  root.provide({
    name: 'test-adapter' as keyof Plugin.Contexts,
    description: 'test adapter',
    value: adapter,
  });
  root.adapters.push('test-adapter' as keyof Plugin.Contexts);
  const emitted: Record<string, unknown>[] = [];
  return {
    emitted,
    ctx: {
      root,
      webServer: { entries: {} },
      projectFs: {
        cwd: () => process.cwd(),
        exists: () => false,
        readText: () => '',
        writeText: () => {},
        stat: () => null,
        readDir: () => [],
        mkdirp: () => {},
      },
      emit: (payload) => { emitted.push(payload); },
    },
  };
}

describe('legacy Host Endpoint summary contract', () => {
  it('advertises method-derived management capabilities from endpoint.list and endpoint.info', async () => {
    const { ctx, emitted } = createContext();

    await handleCoreRpc({ type: 'endpoint.list', requestId: 'list' }, ctx);
    await handleCoreRpc({
      type: 'endpoint.info',
      requestId: 'info',
      data: { adapter: 'test-adapter', endpointId: 'bot-1' },
    }, ctx);

    const expected = ['listFriends', 'listGroups', 'kickGroupMember'];
    expect(emitted[0]).toMatchObject({
      requestId: 'list',
      data: { endpoints: [{ managementCapabilities: expected }] },
    });
    expect(emitted[1]).toMatchObject({
      requestId: 'info',
      data: { managementCapabilities: expected },
    });
  });
});
