import { describe, expect, it, vi } from 'vitest';
import {
  dispatchRuntimeConsoleRpc,
  pickRpcReply,
} from '../src/console-rpc.js';
import { VIEWER, userPrincipal } from './fixtures/principals.js';
import { authorizeConsoleHttp } from '../src/access-control.js';
import { PLUGIN_SWITCH_REQUIRES_GATEWAY } from '../src/console-plugin-rpc.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProjectFileTree, readProjectFile, saveProjectFile } from '../src/project-files.js';

describe('runtime console RPC', () => {
  it('denies raw configuration to demo before reading secret-bearing storage', async () => {
    for (const type of ['config:get', 'config:get-all', 'config:get-source']) {
      let reads = 0;
      const read = async () => { reads++; return { apiKey: 'fixture-secret-must-not-leak' }; };
      const replies = await dispatchRuntimeConsoleRpc({ type, requestId: 100 }, {
        authScope: 'full', principal: VIEWER, listPages: async () => [], readConfigDocument: read,
        readConfigSource: async () => { reads++; return { source: 'apiKey: fixture-secret-must-not-leak', format: 'yaml', revision: 'fixture', configKeys: [] }; },
      });
      expect(pickRpcReply({ type, requestId: 100 }, replies)?.error).toMatch(/缺少权限/);
      expect(reads).toBe(0);
      expect(JSON.stringify(replies)).not.toContain('fixture-secret-must-not-leak');
    }
  });

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

    const source = await dispatchRuntimeConsoleRpc(
      { type: 'config:get-source', requestId: 4 },
      {
        authScope: 'full',
        listPages: async () => pages,
        readConfigSource: async () => ({
          source: 'plugins: {}\n',
          format: 'yaml',
          revision: 'a'.repeat(64),
          configKeys: ['@zhin.js/adapter-sandbox'],
        }),
      },
    );
    expect(pickRpcReply({ type: 'config:get-source', requestId: 4 }, source)).toEqual({
      requestId: 4,
      data: {
        source: 'plugins: {}\n',
        format: 'yaml',
        revision: 'a'.repeat(64),
        configKeys: ['@zhin.js/adapter-sandbox'],
      },
    });
  });

  it('denies writes to a read-only principal and unmapped types to every user', async () => {
    const denied = await dispatchRuntimeConsoleRpc(
      { type: 'config:replace-source', requestId: 3 },
      { authScope: 'full', principal: VIEWER, listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'config:replace-source', requestId: 3 }, denied))
      .toMatchObject({ code: 'forbidden', error: expect.stringMatching(/缺少权限/) });
    const unmapped = await dispatchRuntimeConsoleRpc(
      { type: 'made.up', requestId: 4 },
      { authScope: 'full', principal: userPrincipal('owner'), listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'made.up', requestId: 4 }, unmapped)).toMatchObject({ code: 'unmapped' });
    const setupOnly = await dispatchRuntimeConsoleRpc(
      { type: 'ping', requestId: 5 },
      { authScope: 'full', principal: { kind: 'bootstrap', open: false }, listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'ping', requestId: 5 }, setupOnly)).toMatchObject({ code: 'setup_required' });
  });

  it('returns a shared plugin install plan for full-scope Console clients', async () => {
    const replies = await dispatchRuntimeConsoleRpc(
      { type: 'plugin:plan-install', requestId: 91, packageName: '@zhin.js/adapter-telegram' },
      {
        authScope: 'full',
        listPages: async () => [],
        pluginManagement: {
          planInstall: async (packageName) => ({
            packageName,
            instanceKey: 'adapter-telegram',
            alreadyDeclared: false,
            alreadyInstalled: false,
            restartRequired: true,
            changes: { packageManifest: 'add-plugin', config: 'create-entry' },
            warnings: ['插件尚未安装'],
          }),
        },
      },
    );
    expect(pickRpcReply({ type: 'plugin:plan-install', requestId: 91 }, replies)).toMatchObject({
      requestId: 91,
      data: { packageName: '@zhin.js/adapter-telegram', restartRequired: true },
    });
  });

  it('does not run package installs, updates or uninstalls inside the instance', async () => {
    // Those are gateway dependency transactions (`gateway.packages.*`, ADR 0054 §4).
    for (const [index, type] of ['plugin:install', 'plugin:update', 'plugin:uninstall'].entries()) {
      const requestId = 92 + index;
      const replies = await dispatchRuntimeConsoleRpc(
        { type, requestId, packageName: '@zhin.js/adapter-telegram', targetVersion: '2.0.0', confirmation: '@zhin.js/adapter-telegram' },
        { authScope: 'full', principal: userPrincipal('owner'), listPages: async () => [] },
      );
      expect(pickRpcReply({ type, requestId }, replies)).toMatchObject({ code: 'unmapped' });
    }
  });

  it('validates plugin config through the shared Console context', async () => {
    const replies = await dispatchRuntimeConsoleRpc(
      { type: 'plugin:validate-config', requestId: 93, pluginName: 'adapter-demo', data: {} },
      {
        authScope: 'full',
        listPages: async () => [],
        validatePluginConfig: async (pluginName, data) => ({
          valid: pluginName === 'adapter-demo' && typeof data === 'object',
          errors: [],
          missingEnv: ['BOT_TOKEN'],
        }),
      },
    );
    expect(pickRpcReply({ type: 'plugin:validate-config', requestId: 93 }, replies)).toMatchObject({
      requestId: 93,
      data: { valid: true, missingEnv: ['BOT_TOKEN'] },
    });
  });

  it('returns plugin diagnostics through the shared Console context', async () => {
    const replies = await dispatchRuntimeConsoleRpc(
      { type: 'plugin:diagnose', requestId: 94, pluginName: 'adapter-demo' },
      {
        authScope: 'full',
        listPages: async () => [],
        diagnosePlugin: async (pluginName) => ({ pluginName, healthy: false, reasons: ['missing token'] }),
      },
    );
    expect(pickRpcReply({ type: 'plugin:diagnose', requestId: 94 }, replies)).toMatchObject({
      requestId: 94,
      data: { pluginName: 'adapter-demo', healthy: false },
    });
  });

  it('reports endpoint connectivity from the current generation', async () => {
    const replies = await dispatchRuntimeConsoleRpc(
      { type: 'endpoint.test', requestId: 97, adapter: 'telegram', endpointKey: 'bot' },
      {
        authScope: 'full', principal: VIEWER,
        listPages: async () => [],
        getEndpoint: async () => ({
          name: 'bot', adapter: 'telegram', connected: true, status: 'online', phase: 'online',
        }),
      },
    );
    expect(pickRpcReply({ type: 'endpoint.test', requestId: 97 }, replies)).toMatchObject({
      data: { reachable: true, connected: true, phase: 'online', message: 'Endpoint 已连接' },
    });
  });

  it('allows read-only status/stats/plugins GETs to a viewer and nothing unmapped', () => {
    const allowed = (method: string, path: string) => authorizeConsoleHttp(VIEWER, method, path).allowed;
    expect(allowed('GET', '/system/status')).toBe(true);
    expect(allowed('GET', '/stats')).toBe(true);
    expect(allowed('GET', '/plugins')).toBe(true);
    expect(allowed('GET', '/plugins/icqq')).toBe(true);
    expect(allowed('GET', '/plugins/%40zhin.js%2Fadapter-icqq')).toBe(true);
    expect(allowed('GET', '/agent/workroom/portfolio')).toBe(false);
    expect(allowed('POST', '/system/status')).toBe(false);
    expect(allowed('POST', '/plugins')).toBe(false);
    expect(allowed('DELETE', '/plugins/icqq')).toBe(false);
    expect(allowed('GET', '/config')).toBe(false);
  });

  it('dispatches canonical endpoint RPCs', async () => {
    const endpoints = [{
      name: 'bot',
      adapter: 'sandbox',
      connected: true,
      status: 'online' as const,
    }];
    const sent: unknown[] = [];
    const ctx = {
      authScope: 'full' as const,
      listPages: async () => [],
      listEndpoints: async () => endpoints,
      getEndpoint: async (adapter: string, endpointKey: string) =>
        (adapter === 'sandbox' && endpointKey === 'bot' ? endpoints[0] : null),
      sendEndpointMessage: async (input: unknown) => {
        sent.push(input);
        return { messageId: 'msg-1' };
      },
    };

    const listed = await dispatchRuntimeConsoleRpc({ type: 'endpoint.list', requestId: 60 }, ctx);
    expect(pickRpcReply({ type: 'endpoint.list', requestId: 60 }, listed)).toMatchObject({
      requestId: 60,
      data: { endpoints: [{ name: 'bot', adapter: 'sandbox' }] },
    });

    const info = await dispatchRuntimeConsoleRpc(
      { type: 'endpoint.info', requestId: 61, data: { adapter: 'sandbox', endpointKey: 'bot' } },
      ctx,
    );
    expect(pickRpcReply({ type: 'endpoint.info', requestId: 61 }, info)).toMatchObject({
      requestId: 61,
      data: { name: 'bot', adapter: 'sandbox', status: 'online' },
    });

    const sent_reply = await dispatchRuntimeConsoleRpc(
      {
        type: 'endpoint.send_message',
        requestId: 63,
        data: {
          adapter: 'sandbox',
          endpointKey: 'bot',
          id: '10001',
          type: 'private',
          content: [{ type: 'text', data: { text: 'hi' } }],
          parent: { type: 'group', id: 'g1' },
        },
      },
      ctx,
    );
    expect(pickRpcReply({ type: 'endpoint.send_message', requestId: 63 }, sent_reply))
      .toMatchObject({ requestId: 63, data: { messageId: 'msg-1' } });
    expect(sent).toEqual([{
      adapter: 'sandbox',
      endpointKey: 'bot',
      conversation: { kind: 'private', id: '10001', parent: { kind: 'group', id: 'g1' } },
      content: [{ type: 'text', data: { text: 'hi' } }],
    }]);
  });

  it('applies the permission map to canonical RPC names', async () => {
    const ctx = {
      authScope: 'full' as const, principal: VIEWER,
      listPages: async () => [],
      listEndpoints: async () => [],
      sendEndpointMessage: async () => ({ messageId: 'msg-demo' }),
    };
    const listed = await dispatchRuntimeConsoleRpc({ type: 'endpoint.list', requestId: 70 }, ctx);
    expect(pickRpcReply({ type: 'endpoint.list', requestId: 70 }, listed)?.error).toBeUndefined();

    // endpoint.send_message needs endpoint.operate: a viewer must NOT drive bots.
    const sentReply = await dispatchRuntimeConsoleRpc(
      {
        type: 'endpoint.send_message',
        requestId: 71,
        adapter: 'sandbox',
        endpointKey: 'bot',
        channelId: '1',
        channelType: 'private',
        content: 'hi',
      },
      ctx,
    );
    expect(pickRpcReply({ type: 'endpoint.send_message', requestId: 71 }, sentReply))
      .toMatchObject({ requestId: 71, code: 'forbidden' });
    // An operator bound to another adapter is denied; one bound to this endpoint is admitted.
    const elsewhere = await dispatchRuntimeConsoleRpc(
      { type: 'endpoint.send_message', requestId: 72, adapter: 'sandbox', endpointKey: 'bot', channelId: '1', channelType: 'private', content: 'hi' },
      { ...ctx, principal: userPrincipal('operator', { kind: 'adapter', key: 'qq' }) },
    );
    expect(pickRpcReply({ type: 'endpoint.send_message', requestId: 72 }, elsewhere)).toMatchObject({ code: 'forbidden' });
    const bound = await dispatchRuntimeConsoleRpc(
      { type: 'endpoint.send_message', requestId: 73, adapter: 'sandbox', endpointKey: 'bot', channelId: '1', channelType: 'private', content: 'hi' },
      { ...ctx, principal: userPrincipal('operator', { kind: 'endpoint', key: 'sandbox/bot' }) },
    );
    expect(pickRpcReply({ type: 'endpoint.send_message', requestId: 73 }, bound)?.code).toBeUndefined();
  });

  it('writes config via config:replace-source and config:set on full scope', async () => {
    let stored = 'plugins: {}\n';
    const document: Record<string, unknown> = { plugins: {} };

    const saved = await dispatchRuntimeConsoleRpc(
      {
        type: 'config:replace-source',
        requestId: 10,
        source: 'plugins:\n  sandbox: {}\n',
        expectedRevision: 'a'.repeat(64),
      },
      {
        authScope: 'full',
        listPages: async () => [],
        replaceConfigSource: async (source) => {
          stored = source;
          return { revision: 'b'.repeat(64), restartRequired: false };
        },
      },
    );
    expect(pickRpcReply({ type: 'config:replace-source', requestId: 10 }, saved)).toMatchObject({
      requestId: 10,
      data: { success: true, revision: 'b'.repeat(64), restartRequired: false },
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

  it('preserves saved-but-unconfirmed application metadata instead of claiming a save failure', async () => {
    const request = { type: 'config:replace-source', requestId: 110, source: 'configVersion: 2\n', expectedRevision: 'a'.repeat(64) };
    const replies = await dispatchRuntimeConsoleRpc(request, {
      authScope: 'full', listPages: async () => [],
      replaceConfigSource: async () => ({ revision: 'b'.repeat(64), restartRequired: false, applicationError: 'unconfirmed' }),
    });
    expect(pickRpcReply(request, replies)).toMatchObject({ data: {
      success: true, revision: 'b'.repeat(64), applicationError: 'unconfirmed', message: '配置已保存，生效结果未确认',
    } });
  });

  it('returns the actual application groups for legacy key writes as well as source writes', async () => {
    const application = { operationId: 'config-1', sourceRevision: 'b'.repeat(64), saved: true,
      generation: 3, applicationRevision: 1, groups: [{ id: 'locale', paths: [['locale']],
        effect: 'reload-plugin' as const, status: 'applied' as const, dependsOn: [] }] };
    const request = { type: 'config:set', requestId: 111, pluginName: 'locale', data: 'en' };
    const replies = await dispatchRuntimeConsoleRpc(request, {
      authScope: 'full', listPages: async () => [],
      setConfigKey: async () => ({ restartRequired: false, application }),
    });
    expect(pickRpcReply(request, replies)).toMatchObject({ data: {
      success: true, application, message: '配置已保存并已生效',
    } });
  });

  it('checks full scope and revision before invoking explicit configuration application', async () => {
    let calls = 0;
    const applyConfig = async () => { calls++; return { status: 'unconfirmed' as const, message: 'Unknown result' }; };
    const request = { type: 'config:apply', requestId: 112, expectedRevision: 'a'.repeat(64) };
    const demo = await dispatchRuntimeConsoleRpc(request, { authScope: 'full', principal: VIEWER, listPages: async () => [], applyConfig });
    expect(pickRpcReply(request, demo)).toHaveProperty('error');
    const malformed = { ...request, expectedRevision: 'missing' };
    expect(pickRpcReply(malformed, await dispatchRuntimeConsoleRpc(malformed,
      { authScope: 'full', listPages: async () => [], applyConfig }))).toHaveProperty('error');
    expect(calls).toBe(0);
    const result = await dispatchRuntimeConsoleRpc(request, { authScope: 'full', listPages: async () => [], applyConfig });
    expect(pickRpcReply(request, result)).toMatchObject({ data: { status: 'unconfirmed' } });
    expect(calls).toBe(1);
  });

  it('does not persist config when shared validation rejects it', async () => {
    let writes = 0;
    const replies = await dispatchRuntimeConsoleRpc(
      { type: 'config:set', requestId: 12, pluginName: 'adapter-demo', data: {} },
      {
        authScope: 'full',
        listPages: async () => [],
        validatePluginConfig: async () => ({
          valid: false,
          errors: [{ path: '$.token', message: '必填项不能为空' }],
          missingEnv: [],
        }),
        setConfigKey: async () => {
          writes += 1;
          return { restartRequired: true };
        },
      },
    );
    expect(pickRpcReply({ type: 'config:set', requestId: 12 }, replies)).toMatchObject({
      requestId: 12,
      error: '配置校验失败',
      data: { valid: false },
    });
    expect(writes).toBe(0);
  });

  it('reads and revision-checks the Workroom-only config RPC', async () => {
    const revision = 'a'.repeat(64);
    const nextRevision = 'b'.repeat(64);
    const workrooms = { support: { name: 'Support' } };
    const ctx = {
      authScope: 'full' as const,
      listPages: async () => [],
      readWorkroomCatalog: async () => ({ agents: { zhin: {} }, workrooms, revision }),
      setWorkroomCatalog: async (next: unknown, expected: string) => {
        expect(next).toEqual(workrooms);
        expect(expected).toBe(revision);
        return { revision: nextRevision, restartRequired: true as const };
      },
    };
    const read = await dispatchRuntimeConsoleRpc({ type: 'workrooms:get', requestId: 81 }, ctx);
    expect(pickRpcReply({ type: 'workrooms:get', requestId: 81 }, read)).toMatchObject({
      data: { workrooms, revision },
    });
    const set = await dispatchRuntimeConsoleRpc({
      type: 'workrooms:set', requestId: 82, data: workrooms, expectedRevision: revision,
    }, ctx);
    expect(pickRpcReply({ type: 'workrooms:set', requestId: 82 }, set)).toMatchObject({
      data: { success: true, revision: nextRevision, restartRequired: true },
    });

    const demoRead = await dispatchRuntimeConsoleRpc(
      { type: 'workrooms:get', requestId: 83 },
      { ...ctx, authScope: 'full', principal: VIEWER },
    );
    expect(pickRpcReply({ type: 'workrooms:get', requestId: 83 }, demoRead)).toMatchObject({
      data: { workrooms, revision },
    });
    const demoWrite = await dispatchRuntimeConsoleRpc(
      { type: 'workrooms:set', requestId: 84, data: workrooms, expectedRevision: revision },
      { ...ctx, authScope: 'full', principal: VIEWER },
    );
    expect(pickRpcReply({ type: 'workrooms:set', requestId: 84 }, demoWrite)?.error)
      .toMatch(/缺少权限/u);
  });

  it('publishes config:updated after config:set / config:replace-source and system:restarting on restart', async () => {
    const published: Array<{ type: string; data: unknown }> = [];
    const publishEvent = (type: string, data: unknown) => {
      published.push({ type, data });
    };

    const set = await dispatchRuntimeConsoleRpc(
      { type: 'config:set', requestId: 60, pluginName: 'http', data: { port: 8080, host: '0.0.0.0' } },
      {
        authScope: 'full',
        listPages: async () => [],
        setConfigKey: async () => ({ restartRequired: true }),
        publishEvent,
      },
    );
    expect(pickRpcReply({ type: 'config:set', requestId: 60 }, set)?.data).toMatchObject({
      success: true,
    });
    expect(published).toEqual([
      { type: 'config:updated', data: { pluginName: 'http', keys: ['port', 'host'] } },
    ]);

    published.length = 0;
    await dispatchRuntimeConsoleRpc(
      {
        type: 'config:replace-source',
        requestId: 61,
        source: 'plugins: {}\n',
        expectedRevision: 'a'.repeat(64),
      },
      {
        authScope: 'full',
        listPages: async () => [],
        replaceConfigSource: async () => ({
          revision: 'b'.repeat(64),
          restartRequired: false,
        }),
        publishEvent,
      },
    );
    expect(published).toEqual([
      { type: 'config:updated', data: { pluginName: null, keys: [] } },
    ]);

    published.length = 0;
    await dispatchRuntimeConsoleRpc(
      { type: 'system:restart', requestId: 62 },
      {
        authScope: 'full',
        listPages: async () => [],
        requestRestart: () => undefined,
        publishEvent,
      },
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe('system:restarting');
  });

  it('lets a viewer browse files but keeps environment and config values behind their own permissions', async () => {
    const tree = await dispatchRuntimeConsoleRpc(
      { type: 'files:tree', requestId: 20 },
      {
        authScope: 'full', principal: VIEWER,
        listPages: async () => [],
        listProjectFiles: async () => [{ name: 'README.md', path: 'README.md', type: 'file' }],
      },
    );
    expect(pickRpcReply({ type: 'files:tree', requestId: 20 }, tree)?.error).toBeUndefined();
    for (const filePath of ['zhin.config.yml', 'sub/.env.production', ['.env']]) {
      const denied = await dispatchRuntimeConsoleRpc(
        { type: 'files:read', requestId: 25, filePath },
        { authScope: 'full', principal: VIEWER, listPages: async () => [], readProjectFile: async () => ({ content: 'SECRET=exposed', size: 14 }) },
      );
      expect(JSON.stringify(denied)).not.toContain('exposed');
      expect(pickRpcReply({ type: 'files:read', requestId: 25 }, denied)?.error).toMatch(/ops\.(env|config)\.read/);
    }

    const deniedEnv = await dispatchRuntimeConsoleRpc(
      { type: 'env:get', requestId: 23, filename: '.env' },
      {
        authScope: 'full', principal: VIEWER,
        listPages: async () => [],
        readEnvFile: async () => 'SECRET=exposed',
      },
    );
    expect(pickRpcReply({ type: 'env:get', requestId: 23 }, deniedEnv)?.error)
      .toMatch(/缺少权限/);

    const deniedEnvViaFiles = await dispatchRuntimeConsoleRpc(
      { type: 'files:read', requestId: 24, filePath: '.env' },
      {
        authScope: 'full', principal: VIEWER,
        listPages: async () => [],
        readProjectFile: async () => ({ content: 'SECRET=exposed', size: 14 }),
      },
    );
    expect(pickRpcReply({ type: 'files:read', requestId: 24 }, deniedEnvViaFiles)?.error)
      .toMatch(/缺少权限/);

    const deniedSave = await dispatchRuntimeConsoleRpc(
      { type: 'files:save', requestId: 21, filePath: 'README.md', content: 'x' },
      { authScope: 'full', principal: VIEWER, listPages: async () => [] },
    );
    expect(pickRpcReply({ type: 'files:save', requestId: 21 }, deniedSave)?.error)
      .toMatch(/缺少权限/);

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

  it('keeps dotenv files out of files:* even for owners and points at the environment page (issue #1250)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhin-rpc-dotenv-'));
    try {
      await writeFile(path.join(root, '.env'), 'SECRET=exposed');
      await writeFile(path.join(root, 'SOUL.md'), '# soul');
      const ctx = {
        authScope: 'full' as const,
        principal: userPrincipal('owner'),
        listPages: async () => [],
        listProjectFiles: () => buildProjectFileTree(root),
        readProjectFile: (filePath: string) => readProjectFile(root, filePath),
        saveProjectFile: (filePath: string, content: string) => saveProjectFile(root, filePath, content),
        // A legacy raw reader is never used: env:get answers the masked view only (issue #1250).
        readEnvFile: async (filename: string) => readFile(path.join(root, filename), 'utf8'),
        readEnvFileView: async (filename: string) => ({
          format: 'masked' as const, file: filename, lines: [{ kind: 'entry' as const, key: 'SECRET' }],
          variables: [{ key: 'SECRET', masked: '●●●●●●●●', length: 7, hasValue: true }], content: 'SECRET=●●●●●●●●\n',
        }),
      };
      const tree = await dispatchRuntimeConsoleRpc({ type: 'files:tree', requestId: 40 }, ctx);
      expect(JSON.stringify(tree)).not.toContain('.env');
      expect(JSON.stringify(tree)).toContain('SOUL.md');
      for (const filePath of ['.env', '.ENV', './.env', '.env/', '%2Eenv']) {
        const read = await dispatchRuntimeConsoleRpc({ type: 'files:read', requestId: 41, filePath }, ctx);
        expect(JSON.stringify(read)).not.toContain('exposed');
        expect(pickRpcReply({ type: 'files:read', requestId: 41 }, read)?.error).toMatch(/\/ops\/env/u);
        const saved = await dispatchRuntimeConsoleRpc({ type: 'files:save', requestId: 42, filePath, content: 'SECRET=planted' }, ctx);
        expect(pickRpcReply({ type: 'files:save', requestId: 42 }, saved)?.error).toMatch(/\/ops\/env/u);
      }
      expect(await readFile(path.join(root, '.env'), 'utf8')).toBe('SECRET=exposed');
      // The environment page keeps working, behind its own permission.
      const env = await dispatchRuntimeConsoleRpc({ type: 'env:get', requestId: 43, filename: '.env' }, ctx);
      expect(pickRpcReply({ type: 'env:get', requestId: 43 }, env)).toMatchObject({ data: { format: 'masked', variables: [{ key: 'SECRET' }] } });
      expect(JSON.stringify(env)).not.toContain('exposed');
      const soul = await dispatchRuntimeConsoleRpc({ type: 'files:read', requestId: 44, filePath: 'SOUL.md' }, ctx);
      expect(pickRpcReply({ type: 'files:read', requestId: 44 }, soul)).toMatchObject({ data: { content: '# soul' } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  describe('environment variables are masked by default (issue #1250)', () => {
    const custom = (permissions: string[]) => Object.freeze({
      ...userPrincipal('viewer'),
      grants: Object.freeze([{ role: 'custom', scope: { kind: 'global' as const }, permissions }]),
    });
    const envCtx = () => {
      const calls: { reveal: unknown[][]; update: unknown[][]; replace: unknown[][]; raw: number } = { reveal: [], update: [], replace: [], raw: 0 };
      return {
        calls,
        ctx: {
          authScope: 'full' as const,
          listPages: async () => [],
          readEnvFile: async () => { calls.raw += 1; return 'SECRET=exposed'; },
          writeEnvFile: async () => { calls.raw += 1; },
          revealEnvVariable: async (file: string, key: string) => { calls.reveal.push([file, key]); return { file, key, value: 'exposed' }; },
          updateEnvVariables: async (file: string, changes: unknown) => { calls.update.push([file, changes]); return { changed: ['PORT'] }; },
          replaceEnvFile: async (file: string, content: string) => { calls.replace.push([file, content]); },
        },
      };
    };

    it('env:get never falls back to the raw file', async () => {
      const { ctx, calls } = envCtx();
      const replies = await dispatchRuntimeConsoleRpc({ type: 'env:get', requestId: 1, filename: '.env' }, { ...ctx, principal: userPrincipal('owner') });
      expect(pickRpcReply({ type: 'env:get', requestId: 1 }, replies)?.error).toBe('Env read is not configured');
      expect(JSON.stringify(replies)).not.toContain('exposed');
      expect(calls.raw).toBe(0);
    });

    it('env:reveal needs ops.env.write and ops.env.read', async () => {
      const denied: [string, ReturnType<typeof custom> | typeof VIEWER][] = [
        ['ops.env.write', VIEWER],
        ['ops.env.write', userPrincipal('operator')],
        ['ops.env.write', custom(['ops.env.read'])],
        ['ops.env.read', custom(['ops.env.write'])],
      ];
      for (const [missing, principal] of denied) {
        const { ctx, calls } = envCtx();
        const replies = await dispatchRuntimeConsoleRpc({ type: 'env:reveal', requestId: 2, filename: '.env', key: 'SECRET' }, { ...ctx, principal });
        expect(pickRpcReply({ type: 'env:reveal', requestId: 2 }, replies)).toMatchObject({ code: 'forbidden', error: `缺少权限 ${missing}` });
        expect(JSON.stringify(replies)).not.toContain('exposed');
        expect(calls.reveal).toEqual([]);
      }
      for (const principal of [userPrincipal('owner'), userPrincipal('admin'), custom(['ops.env.read', 'ops.env.write'])]) {
        const { ctx, calls } = envCtx();
        const replies = await dispatchRuntimeConsoleRpc({ type: 'env:reveal', requestId: 3, filename: '.env', key: 'SECRET' }, { ...ctx, principal });
        expect(pickRpcReply({ type: 'env:reveal', requestId: 3 }, replies)).toMatchObject({ data: { file: '.env', key: 'SECRET', value: 'exposed' } });
        expect(calls.reveal).toEqual([['.env', 'SECRET']]);
      }
      const { ctx } = envCtx();
      const missingKey = await dispatchRuntimeConsoleRpc({ type: 'env:reveal', requestId: 4, filename: '.env' }, { ...ctx, principal: userPrincipal('owner') });
      expect(pickRpcReply({ type: 'env:reveal', requestId: 4 }, missingKey)?.error).toBe('key is required');
    });

    it('env:save writes the submitted changes only; a whole file must be declared as replace', async () => {
      const owner = userPrincipal('owner');
      const { ctx, calls } = envCtx();
      const changes = [{ key: 'PORT', value: '9090' }];
      const saved = await dispatchRuntimeConsoleRpc({ type: 'env:save', requestId: 5, filename: '.env', changes }, { ...ctx, principal: owner });
      expect(pickRpcReply({ type: 'env:save', requestId: 5 }, saved)).toMatchObject({ data: { success: true, changed: ['PORT'] } });
      expect(calls.update).toEqual([['.env', changes]]);

      // An older Console posts back the file it was shown: refused without a declaration.
      const legacy = await dispatchRuntimeConsoleRpc({ type: 'env:save', requestId: 6, filename: '.env', content: 'SECRET=●●●●●●●●\n' }, { ...ctx, principal: owner });
      expect(pickRpcReply({ type: 'env:save', requestId: 6 }, legacy)?.error).toMatch(/逐键保存/u);
      const both = await dispatchRuntimeConsoleRpc({ type: 'env:save', requestId: 7, filename: '.env', content: 'A=1', changes, mode: 'replace' }, { ...ctx, principal: owner });
      expect(pickRpcReply({ type: 'env:save', requestId: 7 }, both)?.error).toMatch(/只能提供一个/u);
      expect(calls.replace).toEqual([]);
      expect(calls.raw).toBe(0);

      const replaced = await dispatchRuntimeConsoleRpc({ type: 'env:save', requestId: 8, filename: '.env', content: 'A=1\n', mode: 'replace' }, { ...ctx, principal: owner });
      expect(pickRpcReply({ type: 'env:save', requestId: 8 }, replaced)).toMatchObject({ data: { success: true } });
      expect(calls.replace).toEqual([['.env', 'A=1\n']]);

      const denied = await dispatchRuntimeConsoleRpc({ type: 'env:save', requestId: 9, filename: '.env', changes }, { ...ctx, principal: VIEWER });
      expect(pickRpcReply({ type: 'env:save', requestId: 9 }, denied)?.error).toMatch(/缺少权限 ops\.env\.write/u);
      expect(calls.update).toHaveLength(1);
    });
  });

  it('answers schema and db stub RPCs', async () => {    const schema = await dispatchRuntimeConsoleRpc(
      { type: 'schema:get', requestId: 30, pluginName: 'repeater' },
      {
        authScope: 'full', principal: VIEWER,
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
      data: { tables: ['im_messages', 'github_oauth_users'] },
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
        authScope: 'full', principal: VIEWER,
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
    vi.useFakeTimers();
    try {
      let restarted = false;
      const denied = await dispatchRuntimeConsoleRpc(
        { type: 'system:restart', requestId: 50 },
        { authScope: 'full', principal: VIEWER, listPages: async () => [] },
      );
      expect(pickRpcReply({ type: 'system:restart', requestId: 50 }, denied)?.error)
        .toMatch(/缺少权限/);

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
      await vi.advanceTimersByTimeAsync(600);
      expect(restarted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses plugin:set-enabled: the global plugin switch is a gateway transaction (ADR 0054 §4)', async () => {
    vi.useFakeTimers();
    try {
      const published: Array<{type: string; data: unknown}> = [];
      let restarted = false;
      const result = await dispatchRuntimeConsoleRpc(
        {type: 'plugin:set-enabled', requestId: 90, instanceKey: 'sandbox', enabled: false},
        {
          authScope: 'full',
          listPages: async () => [],
          requestRestart: () => { restarted = true; },
          publishEvent: (type, data) => { published.push({type, data}); },
        },
      );
      expect(pickRpcReply({type: 'plugin:set-enabled', requestId: 90}, result)).toMatchObject({
        requestId: 90,
        error: PLUGIN_SWITCH_REQUIRES_GATEWAY,
      });
      expect(PLUGIN_SWITCH_REQUIRES_GATEWAY).toContain('zhin enable / zhin disable');
      // Nothing written, published or restarted by the instance.
      expect(published).toEqual([]);
      await vi.advanceTimersByTimeAsync(600);
      expect(restarted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('does not map removed model authorities and keeps inference writes behind agent.configure', () => {
  for (const route of ['personal-models', 'personal-session', 'personal-sessions', 'model-policy']) {
    for (const method of ['GET', 'PUT', 'POST']) expect(authorizeConsoleHttp(userPrincipal('owner'), method, `/agent/${route}`).allowed).toBe(false);
  }
  expect(authorizeConsoleHttp(VIEWER, 'GET', '/agent/inference/targets').allowed).toBe(true);
  for (const route of ['login/begin', 'login/complete', 'client/prepare', 'disconnect', 'key/prepare']) {
    expect(authorizeConsoleHttp(VIEWER, 'POST', `/agent/inference/${route}`).allowed).toBe(false);
    expect(authorizeConsoleHttp(userPrincipal('admin'), 'POST', `/agent/inference/${route}`).allowed).toBe(true);
  }
});
