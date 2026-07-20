import { describe, expect, it } from 'vitest';
import {
  dispatchRuntimeConsoleRpc,
  isDemoHttpAllowed,
  pickRpcReply,
} from '../src/console-rpc.js';

describe('runtime console RPC', () => {
  it('answers ping and maps pages for entries:get', async () => {
    const pages = Object.freeze([
      Object.freeze({
        id: 'cap-1',
        localName: 'sandbox',
        title: 'Sandbox',
        route: '/p-sandbox',
        module: '/assets/client/sandbox.js',
        order: 10,
        hash: 'abc',
      }),
    ]);
    const ping = await dispatchRuntimeConsoleRpc(
      { type: 'ping', requestId: 1 },
      { authScope: 'full', listPages: async () => pages },
    );
    expect(pickRpcReply({ type: 'ping', requestId: 1 }, ping)).toEqual({
      type: 'pong',
      requestId: 1,
    });

    const entries = await dispatchRuntimeConsoleRpc(
      { type: 'entries:get', requestId: 2 },
      { authScope: 'full', listPages: async () => pages },
    );
    expect(pickRpcReply({ type: 'entries:get', requestId: 2 }, entries)).toMatchObject({
      requestId: 2,
      data: [{
        id: 'sandbox',
        module: '/assets/client/sandbox.js',
        meta: { name: 'Sandbox' },
        route: '/p-sandbox',
      }],
    });

    const yaml = await dispatchRuntimeConsoleRpc(
      { type: 'config:get-yaml', requestId: 4 },
      {
        authScope: 'demo',
        listPages: async () => pages,
        readConfigYaml: async () => 'plugins: []\n',
        listPluginKeys: async () => ['@zhin.js/adapter-sandbox'],
      },
    );
    expect(pickRpcReply({ type: 'config:get-yaml', requestId: 4 }, yaml)).toEqual({
      requestId: 4,
      data: { yaml: 'plugins: []\n', pluginKeys: ['@zhin.js/adapter-sandbox'] },
    });
  });

  it('enforces demo RPC allowlist and HTTP path allowlist', async () => {
    const denied = await dispatchRuntimeConsoleRpc(
      { type: 'config:save-yaml', requestId: 3 },
      { authScope: 'demo', listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'config:save-yaml', requestId: 3 }, denied)?.error)
      .toMatch(/Demo scope/);

    expect(isDemoHttpAllowed('POST', '/api/console/request', '/api')).toBe(true);
    expect(isDemoHttpAllowed('GET', '/api/events', '/api')).toBe(true);
    expect(isDemoHttpAllowed('POST', '/api/plugins', '/api')).toBe(false);
  });

  it('writes config via config:save-yaml and config:set on full scope', async () => {
    let stored = 'plugins: []\n';
    const document: Record<string, unknown> = { plugins: [] };

    const saved = await dispatchRuntimeConsoleRpc(
      { type: 'config:save-yaml', requestId: 10, yaml: 'plugins:\n  - sandbox\n' },
      {
        authScope: 'full',
        listPages: async () => [],
        writeConfigYaml: async (yaml) => {
          stored = yaml;
        },
      },
    );
    expect(pickRpcReply({ type: 'config:save-yaml', requestId: 10 }, saved)).toMatchObject({
      requestId: 10,
      data: { success: true },
    });
    expect(stored).toContain('sandbox');

    const set = await dispatchRuntimeConsoleRpc(
      { type: 'config:set', requestId: 11, pluginName: 'http', data: { port: 8080 } },
      {
        authScope: 'full',
        listPages: async () => [],
        setConfigKey: async (pluginName, data) => {
          document[pluginName] = data;
          return { restartRequired: true };
        },
      },
    );
    expect(pickRpcReply({ type: 'config:set', requestId: 11 }, set)).toMatchObject({
      requestId: 11,
      data: { success: true, reloaded: false },
    });
    expect(document.http).toEqual({ port: 8080 });
  });

  it('keeps project files and environment values outside demo scope', async () => {
    const tree = await dispatchRuntimeConsoleRpc(
      { type: 'files:tree', requestId: 20 },
      {
        authScope: 'demo',
        listPages: async () => [],
        listProjectFiles: async () => [{ name: 'README.md', path: 'README.md', type: 'file' }],
      },
    );
    expect(pickRpcReply({ type: 'files:tree', requestId: 20 }, tree)?.error)
      .toMatch(/Demo scope/);

    const deniedEnv = await dispatchRuntimeConsoleRpc(
      { type: 'env:get', requestId: 23, filename: '.env' },
      {
        authScope: 'demo',
        listPages: async () => [],
        readEnvFile: async () => 'SECRET=exposed',
      },
    );
    expect(pickRpcReply({ type: 'env:get', requestId: 23 }, deniedEnv)?.error)
      .toMatch(/Demo scope/);

    const deniedEnvViaFiles = await dispatchRuntimeConsoleRpc(
      { type: 'files:read', requestId: 24, filePath: '.env' },
      {
        authScope: 'demo',
        listPages: async () => [],
        readProjectFile: async () => ({ content: 'SECRET=exposed', size: 14 }),
      },
    );
    expect(pickRpcReply({ type: 'files:read', requestId: 24 }, deniedEnvViaFiles)?.error)
      .toMatch(/Demo scope/);

    const deniedSave = await dispatchRuntimeConsoleRpc(
      { type: 'files:save', requestId: 21, filePath: 'README.md', content: 'x' },
      { authScope: 'demo', listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'files:save', requestId: 21 }, deniedSave)?.error)
      .toMatch(/Demo scope/);

    const saved = await dispatchRuntimeConsoleRpc(
      { type: 'files:save', requestId: 22, filePath: 'README.md', content: 'ok' },
      {
        authScope: 'full',
        listPages: async () => [],
        saveProjectFile: async () => undefined,
      },
    );
    expect(pickRpcReply({ type: 'files:save', requestId: 22 }, saved)).toMatchObject({
      requestId: 22,
      data: { success: true },
    });
  });

  it('answers schema and db stub RPCs', async () => {    const schema = await dispatchRuntimeConsoleRpc(
      { type: 'schema:get', requestId: 30, pluginName: 'repeater' },
      {
        authScope: 'demo',
        listPages: async () => [],
        getSchema: async (name) => (name === 'repeater' ? { type: 'object' } : null),
      },
    );
    expect(pickRpcReply({ type: 'schema:get', requestId: 30 }, schema)).toMatchObject({
      requestId: 30,
      data: { type: 'object' },
    });

    const dbInfo = await dispatchRuntimeConsoleRpc(
      { type: 'db:info', requestId: 31 },
      { authScope: 'full', listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'db:info', requestId: 31 }, dbInfo)).toMatchObject({
      requestId: 31,
      data: { connected: false },
    });

    const deniedWrite = await dispatchRuntimeConsoleRpc(
      { type: 'db:insert', requestId: 32 },
      { authScope: 'full', listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'db:insert', requestId: 32 }, deniedWrite)?.error)
      .toMatch(/not available/);
  });

  it('serves db:info and db:tables from the wired Database host', async () => {
    const ctx = {
      authScope: 'full' as const,
      listPages: async () => [],
      dbInfo: () => ({ dialect: 'sqlite', connected: true, tables: 2 }),
      dbTables: () => ['im_messages', 'github_oauth_users'],
    };
    const info = await dispatchRuntimeConsoleRpc({ type: 'db:info', requestId: 33 }, ctx);
    expect(pickRpcReply({ type: 'db:info', requestId: 33 }, info)).toEqual({
      requestId: 33,
      data: { dialect: 'sqlite', connected: true, tables: 2 },
    });

    const tables = await dispatchRuntimeConsoleRpc({ type: 'db:tables', requestId: 34 }, ctx);
    expect(pickRpcReply({ type: 'db:tables', requestId: 34 }, tables)).toEqual({
      requestId: 34,
      data: ['im_messages', 'github_oauth_users'],
    });
  });

  it('routes all Database CRUD and KV operations through one administration port', async () => {
    const calls: string[] = [];
    const database = {
      info: () => ({ dialect: 'redis', type: 'keyvalue' as const, tables: ['cache'], connected: true }),
      tables: () => [{ name: 'cache' }],
      select: async () => ({ rows: [], total: 0, page: 1, pageSize: 50 }),
      insert: async () => { calls.push('insert'); },
      update: async () => { calls.push('update'); return 1; },
      delete: async () => { calls.push('delete'); return 1; },
      dropTable: async () => { calls.push('drop'); },
      kvGet: async () => 'value',
      kvSet: async () => { calls.push('kv-set'); },
      kvDelete: async () => { calls.push('kv-delete'); },
      kvEntries: async () => [{ key: 'key', value: 'value' }],
    };
    const ctx = { authScope: 'full' as const, listPages: async () => [], database };

    for (const message of [
      { type: 'db:insert', table: 'cache', row: { key: 'key', value: 'value' } },
      { type: 'db:update', table: 'cache', row: { value: 'next' }, where: { key: 'key' } },
      { type: 'db:delete', table: 'cache', where: { key: 'key' } },
      { type: 'db:drop-table', table: 'cache' },
      { type: 'db:kv:set', table: 'cache', key: 'key', value: 'value' },
      { type: 'db:kv:delete', table: 'cache', key: 'key' },
    ]) {
      const reply = pickRpcReply(message, await dispatchRuntimeConsoleRpc(message, ctx));
      expect(reply?.error).toBeUndefined();
    }
    expect(calls).toEqual(['insert', 'update', 'delete', 'drop', 'kv-set', 'kv-delete']);

    const get = await dispatchRuntimeConsoleRpc({ type: 'db:kv:get', table: 'cache', key: 'key' }, ctx);
    expect(pickRpcReply({ type: 'db:kv:get' }, get)?.data).toEqual({ key: 'key', value: 'value' });
    const entries = await dispatchRuntimeConsoleRpc({ type: 'db:kv:entries', table: 'cache' }, ctx);
    expect(pickRpcReply({ type: 'db:kv:entries' }, entries)?.data).toEqual({
      entries: [{ key: 'key', value: 'value' }],
    });
  });

  it('lists endpoints when registry callbacks are provided', async () => {
    const listed = await dispatchRuntimeConsoleRpc(
      { type: 'endpoint.list', requestId: 40 },
      {
        authScope: 'demo',
        listPages: async () => [],
        listEndpoints: async () => [{
          name: 'bot',
          adapter: 'sandbox',
          connected: true,
          status: 'online',
        }],
      },
    );
    expect(pickRpcReply({ type: 'endpoint.list', requestId: 40 }, listed)).toMatchObject({
      requestId: 40,
      data: { endpoints: [{ name: 'bot', adapter: 'sandbox' }] },
    });
  });

  it('accepts system:restart on full scope and blocks demo', async () => {
    let restarted = false;
    const denied = await dispatchRuntimeConsoleRpc(
      { type: 'system:restart', requestId: 50 },
      { authScope: 'demo', listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'system:restart', requestId: 50 }, denied)?.error)
      .toMatch(/Demo scope/);

    const ok = await dispatchRuntimeConsoleRpc(
      { type: 'system:restart', requestId: 51 },
      {
        authScope: 'full',
        listPages: async () => [],
        requestRestart: () => { restarted = true; },
      },
    );
    expect(pickRpcReply({ type: 'system:restart', requestId: 51 }, ok)).toMatchObject({
      requestId: 51,
      data: { success: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(restarted).toBe(true);
  });
});
