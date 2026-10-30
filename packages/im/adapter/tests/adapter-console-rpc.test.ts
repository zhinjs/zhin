import { describe, expect, it, vi } from 'vitest';
import {
  createAdapterConsoleRpc,
  endpointConfigurationStoreToken,
  type AdapterConsoleResources,
  type AdapterConsoleSpec,
  type ConfiguredEndpointEntry,
  type EndpointConfigurationStore,
} from '../src/index.js';
import { PluginConsoleRpcError, type Token } from '@zhin.js/plugin-runtime';

function fakeStore(initial: ConfiguredEndpointEntry[] = []): EndpointConfigurationStore & {
  entries: ConfiguredEndpointEntry[];
  added: Parameters<EndpointConfigurationStore['add']>[0][];
  removed: string[];
} {
  const entries = [...initial];
  const added: Parameters<EndpointConfigurationStore['add']>[0][] = [];
  const removed: string[] = [];
  return {
    entries,
    added,
    removed,
    async list() { return entries; },
    async add(request) {
      if (entries.some((entry) => entry.id === request.entry.id)) {
        const { EndpointConfigurationError } = await import('../src/index.js');
        throw new EndpointConfigurationError('duplicate_entry', {
          adapterKey: request.adapterKey,
          endpointId: request.entry.id,
        });
      }
      added.push(request);
      entries.push(request.entry);
      return { filePath: '/tmp/zhin.config.yml' };
    },
    async remove(_adapterKey, endpointId) {
      removed.push(endpointId);
      const index = entries.findIndex((entry) => entry.id === endpointId);
      if (index < 0) return { filePath: '/tmp/zhin.config.yml', removed: false };
      entries.splice(index, 1);
      return { filePath: '/tmp/zhin.config.yml', removed: true };
    },
  };
}

function resources(store?: EndpointConfigurationStore): AdapterConsoleResources {
  return {
    has: <T>(token: Token<T>) => store !== undefined && token === endpointConfigurationStoreToken,
    use: <T>(token: Token<T>) => {
      if (token !== endpointConfigurationStoreToken || !store) throw new Error('unexpected token');
      return store as unknown as T;
    },
  };
}

const baseSpec: AdapterConsoleSpec = {
  adapterKey: 'telegram',
  adapterDisplayName: 'Telegram',
  fields: [
    { key: 'token', required: true, env: true, description: 'bot token' },
  ],
  readPermission: 'telegram:read',
  writePermission: 'telegram:write',
  running: () => [{ id: 'bot', mode: 'polling' }],
  getConfig: () => ({ endpoints: [{ id: 'bot', token: '${TELEGRAM_BOT_TOKEN}' }] }),
};

function statusOf(rpc: ReturnType<typeof createAdapterConsoleRpc>) {
  const method = rpc.methods.get('status');
  if (!method) throw new Error('missing status');
  return method.handler({}, { signal: new AbortController().signal }) as Promise<Record<string, unknown>>;
}

describe('createAdapterConsoleRpc', () => {
  it('reports running/configured endpoints and masks secret fields', async () => {
    const store = fakeStore([
      { id: 'bot', token: '${TELEGRAM_BOT_TOKEN}' },
      { id: 'inline', token: '123456:secret' },
    ]);
    const rpc = createAdapterConsoleRpc(baseSpec, resources(store));
    const status = await statusOf(rpc);
    expect(status).toMatchObject({
      adapterKey: 'telegram',
      displayName: 'Telegram',
      canAdd: true,
      canRemove: true,
      configStore: true,
      running: [{ id: 'bot', mode: 'polling' }],
      readPermission: 'telegram:read',
      writePermission: 'telegram:write',
    });
    const configured = status.configured as Array<{ id: string; values: Record<string, string> }>;
    expect(configured.find((entry) => entry.id === 'bot')?.values.token).toBe('${TELEGRAM_BOT_TOKEN}');
    expect(configured.find((entry) => entry.id === 'inline')?.values.token).toBe('••••••');
  });

  it('writes credentials to .env and the endpoint entry to config', async () => {
    const store = fakeStore();
    const rpc = createAdapterConsoleRpc(baseSpec, resources(store));
    const add = rpc.methods.get('endpoint-add');
    expect(add?.requiredPermissions).toEqual(['telegram:write']);
    const result = await add!.handler({ id: 'my-bot', values: { token: '123:abc' } }, { signal: new AbortController().signal });
    expect(result).toMatchObject({ id: 'my-bot', restartRequired: true });
    expect(store.added).toHaveLength(1);
    expect(store.added[0]).toMatchObject({
      adapterKey: 'telegram',
      entry: { id: 'my-bot', token: '${TELEGRAM_MY_BOT_TOKEN}' },
      environment: { TELEGRAM_MY_BOT_TOKEN: '123:abc' },
    });
  });

  it('rejects missing required fields, unknown fields and duplicate ids', async () => {
    const store = fakeStore([{ id: 'bot', token: '${TELEGRAM_BOT_TOKEN}' }]);
    const rpc = createAdapterConsoleRpc(baseSpec, resources(store));
    const add = rpc.methods.get('endpoint-add')!;
    const signal = new AbortController().signal;
    await expect(add.handler({ id: 'x', values: {} }, { signal })).rejects.toBeInstanceOf(PluginConsoleRpcError);
    await expect(add.handler({ id: 'x', values: { nope: '1' } }, { signal })).rejects.toThrow(/未知字段/u);
    await expect(add.handler({ id: 'bot', values: { token: '1' } }, { signal })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('removes configured endpoints and reports missing ids', async () => {
    const store = fakeStore([{ id: 'bot', token: '${TOKEN}' }]);
    const rpc = createAdapterConsoleRpc(baseSpec, resources(store));
    const remove = rpc.methods.get('endpoint-remove')!;
    const signal = new AbortController().signal;
    await expect(remove.handler({ id: 'bot' }, { signal })).resolves.toMatchObject({ removed: true });
    await expect(remove.handler({ id: 'bot' }, { signal })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('degrades to read-only when no config store is available', async () => {
    const rpc = createAdapterConsoleRpc(baseSpec, resources());
    const status = await statusOf(rpc);
    expect(status).toMatchObject({ canAdd: false, canRemove: false, configStore: false });
    expect(rpc.methods.has('endpoint-add')).toBe(false);
    expect(rpc.methods.has('endpoint-remove')).toBe(false);
    const configured = status.configured as Array<{ id: string; values: Record<string, string> }>;
    expect(configured[0]?.id).toBe('bot');
    // 没有配置存储时仍只返回安全视图：env 字段不是 `${ENV}` 引用就遮蔽。
    expect(configured[0]?.values).toEqual({ token: '${TELEGRAM_BOT_TOKEN}' });
  });

  it('exposes adapter actions and filters them by availableActions', async () => {
    const handler = vi.fn(async () => ({ message: 'ok', details: { state: 'waiting' } }));
    const rpc = createAdapterConsoleRpc({
      ...baseSpec,
      availableActions: () => ['bind'],
      actions: {
        bind: { label: 'Bind', handler },
      },
    }, resources(fakeStore()));
    const status = await statusOf(rpc);
    expect(status.actions).toEqual([
      expect.objectContaining({ name: 'bind', label: 'Bind', fields: [], options: [] }),
    ]);
    const action = rpc.methods.get('bind')!;
    await expect(action.handler({}, { signal: new AbortController().signal }))
      .resolves.toEqual({ message: 'ok', details: { state: 'waiting' } });
  });

  it('rejects reserved action names', () => {
    expect(() => createAdapterConsoleRpc({
      ...baseSpec,
      actions: { 'endpoint-add': { label: 'x', handler: async () => ({}) } },
    }, resources(fakeStore()))).toThrow(/Reserved/u);
  });
});
