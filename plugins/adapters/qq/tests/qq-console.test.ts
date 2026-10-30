import { describe, expect, it } from 'vitest';
import { PluginConsoleRpcError } from 'zhin.js';
import { endpointConfigurationStoreToken, type EndpointConfigurationStore } from 'zhin.js/adapter';
import type { Token } from 'zhin.js/plugin-runtime';
import {
  cancelQqConsoleBind,
  completeQqConsoleBind,
  startQqConsoleBind,
} from '../src/qq-console.js';
import { createQqRuntimeState, type QqRuntimeState } from '../src/qq-runtime-state.js';
import { createQqConsoleRpc } from '../src/console.js';

function fakeStore() {
  const added: Parameters<EndpointConfigurationStore['add']>[0][] = [];
  const store: EndpointConfigurationStore = {
    async list() { return []; },
    async add(request) {
      added.push(request);
      return { filePath: '/tmp/zhin.config.yml' };
    },
    async remove() { return { filePath: '/tmp/zhin.config.yml', removed: false }; },
  };
  return { store, added };
}

function stateWithPending(endpointId = 'bot-1'): QqRuntimeState {
  const state = createQqRuntimeState();
  state.consoleBind = {
    state: 'scanned',
    startedAt: Date.now(),
    pending: { endpointId, appId: 'app-1', appSecret: 'secret-1' },
  };
  return state;
}

describe('QQ console binding', () => {
  it('writes .env references and config fields after choosing bot kind', async () => {
    const state = stateWithPending();
    const { store, added } = fakeStore();
    const result = await completeQqConsoleBind(state, store, 'private');
    expect(result).toMatchObject({ endpointId: 'bot-1', botKind: 'private' });
    expect(result.intents).toContain('GUILD_MESSAGES');
    expect(added[0]).toMatchObject({
      adapterKey: 'qq',
      entry: {
        id: 'bot-1',
        appid: '${QQ_BOT_1_APPID}',
        secret: '${QQ_BOT_1_SECRET}',
        botKind: 'private',
      },
      environment: { QQ_BOT_1_APPID: 'app-1', QQ_BOT_1_SECRET: 'secret-1' },
    });
    expect(state.consoleBind).toBeNull();
  });

  it('rejects an invalid or missing bot kind and keeps the pending credentials', async () => {
    const state = stateWithPending();
    const { store } = fakeStore();
    await expect(completeQqConsoleBind(state, store, 'nope')).rejects.toBeInstanceOf(PluginConsoleRpcError);
    expect(state.consoleBind?.pending?.endpointId).toBe('bot-1');
    state.consoleBind = null;
    await expect(completeQqConsoleBind(state, store, 'public')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('cancels a pending console binding', () => {
    const state = stateWithPending();
    expect(cancelQqConsoleBind(state)).toBe(true);
    expect(state.consoleBind).toBeNull();
    expect(cancelQqConsoleBind(state)).toBe(false);
  });

  it('refuses to start while another bind flow is active', () => {
    const state = createQqRuntimeState();
    state.bindFlow = { stop() {} };
    expect(() => startQqConsoleBind(state)).toThrow(PluginConsoleRpcError);
    state.bindFlow = null;
    state.pendingBotKind = { endpointId: 'x', appId: 'a', appSecret: 's', sessionKey: '' };
    expect(() => startQqConsoleBind(state)).toThrow(PluginConsoleRpcError);
  });
});

describe('QQ console RPC', () => {
  function rpcWith(store: EndpointConfigurationStore, state: QqRuntimeState) {
    return createQqConsoleRpc(state, {
      has: <T,>(token: Token<T>) => token === endpointConfigurationStoreToken,
      use: <T,>(token: Token<T>) => {
        if (token !== endpointConfigurationStoreToken) throw new Error('unexpected token');
        return store as unknown as T;
      },
    }, () => ({}));
  }

  async function actionsOf(rpc: ReturnType<typeof createQqConsoleRpc>) {
    const method = rpc.methods.get('status');
    if (!method) throw new Error('missing status');
    const status = await method.handler({}, { signal: new AbortController().signal }) as {
      actions: { name: string }[];
      extra?: Record<string, string | number | boolean>;
    };
    return status;
  }

  it('offers QR binding first, then public/private selection, without leaking the secret', async () => {
    const { store } = fakeStore();
    const state = createQqRuntimeState();
    const rpc = rpcWith(store, state);
    expect((await actionsOf(rpc)).actions.map((action) => action.name)).toEqual(['qq-bind-start']);

    state.consoleBind = {
      state: 'scanned',
      startedAt: Date.now(),
      pending: { endpointId: 'bot-1', appId: 'app-1', appSecret: 'secret-1' },
    };
    const status = await actionsOf(rpc);
    expect(status.actions.map((action) => action.name)).toEqual(['qq-bind-kind', 'qq-bind-cancel']);
    expect(JSON.stringify(status.extra)).not.toContain('secret-1');
    expect(status.extra).toMatchObject({ bindState: 'scanned', bindEndpoint: 'bot-1' });
  });
});
