import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, type ConsoleUserPrincipal, type HttpHost } from '@zhin.js/host-http';
import type { BridgeRouteTable, InstanceRequestContext, InstanceTransport, InstanceWsOpenInfo } from '@zhin.js/host-http/bridge';
import type { GatewayPackageTransactionResult } from '@zhin.js/console-protocol';
import { GatewayHttpServer } from '../../src/http/gateway-http-server.js';
import { createGatewayPluginSwitchRpc, isGatewayPluginSwitch, type GatewayPluginSwitchPackages } from '../../src/http/plugin-switch-rpc.js';
import { GatewayError } from '../../src/packages/errors.js';
import { installTestConsoleUsers, testUser } from '../utils/console-users.js';

/** Records forwarded Console requests; answers like the instance would. */
class FakeTransport implements InstanceTransport {
  readonly ready = true;
  readonly table: BridgeRouteTable = { revision: 1, apiBase: '/api', http: [{ method: 'ALL', pattern: '/*' }], ws: [] };
  readonly requests: Array<{ body: string; context: InstanceRequestContext }> = [];
  routes(): BridgeRouteTable { return this.table; }
  onRoutes(): () => void { return () => undefined; }
  async fetch(request: Request, context: InstanceRequestContext): Promise<Response> {
    this.requests.push({ body: request.body ? await request.text() : '', context });
    return jsonResponse(200, { success: true, from: 'instance' });
  }
  async openWebSocket(_info: InstanceWsOpenInfo): Promise<boolean> { return false; }
}

/** Holds only `feature.toggle` (the permission the switch used to need). */
const toggleOnly: ConsoleUserPrincipal = Object.freeze({
  ...testUser('viewer', { kind: 'global' }, 'toggle-token'),
  grants: Object.freeze([{ role: 'toggler', scope: { kind: 'global' as const }, permissions: ['feature.toggle', 'feature.view'] }]),
  roles: Object.freeze(['toggler']),
});

function transaction(overrides: Partial<GatewayPackageTransactionResult> = {}): GatewayPackageTransactionResult {
  return Object.freeze({
    id: 'tx1', operation: 'disable', packages: [{ name: '@zhin.js/plugin-rss', spec: '@zhin.js/plugin-rss', source: 'npm' }],
    ok: true, status: 'succeeded', startedAt: 1, finishedAt: 2,
    plugin: { instanceKey: 'rss', packageName: '@zhin.js/plugin-rss', enabled: false, changed: true },
    instance: { before: 'running', after: 'running' },
    ...overrides,
  }) as GatewayPackageTransactionResult;
}

const servers: GatewayHttpServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function serve(options: {
  packages?: GatewayPluginSwitchPackages | undefined;
  document?: Record<string, unknown>;
  projectRoot?: string;
} = {}) {
  const transport = new FakeTransport();
  const server = new GatewayHttpServer({
    http: { host: '127.0.0.1', port: 0 },
    instance: { transport: () => transport, state: () => 'running' },
  });
  servers.push(server);
  const audits = installTestConsoleUsers(server as unknown as HttpHost, {
    'owner-token': 'owner', 'admin-token': 'admin', 'operator-token': 'operator', 'toggle-token': toggleOnly, 'viewer-token': 'viewer',
  });
  const document = options.document ?? { configVersion: 2, plugins: { rss: '@zhin.js/plugin-rss' }, disable_plugins: ['rss'] };
  server.useConsoleRpc(createGatewayPluginSwitchRpc({
    projectRoot: options.projectRoot ?? '/nonexistent',
    packages: 'packages' in options ? options.packages : undefined,
    ...(options.projectRoot ? {} : { readConfig: async () => ({ revision: 'rev-after', document }) }),
  }));
  const address = await server.listen();
  const post = async (token: string, body: unknown) => {
    const response = await fetch(`${address.origin}/api/console/request`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { transport, audits, post };
}

function fakePackages(result: GatewayPackageTransactionResult | Error = transaction()) {
  const setEnabled = vi.fn(async (_request: { plugin: unknown }, _enabled: boolean, _options: { principal: unknown }) => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { setEnabled } satisfies GatewayPluginSwitchPackages;
}

describe('gateway global plugin switch (ADR 0054 §4)', () => {
  it('claims plugin:set-enabled and feature.set-enabled at the global level only', () => {
    expect(isGatewayPluginSwitch({ type: 'plugin:set-enabled' })).toBe(true);
    expect(isGatewayPluginSwitch({ type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global' } })).toBe(true);
    expect(isGatewayPluginSwitch({ type: 'feature.set-enabled', level: 'global' })).toBe(true);
    for (const level of ['adapter', 'endpoint', 'conversation']) {
      expect(isGatewayPluginSwitch({ type: 'feature.set-enabled', data: { plugin: 'rss', level, key: 'qq' } }), level).toBe(false);
    }
    expect(isGatewayPluginSwitch({ type: 'feature.set-override', data: { level: 'global' } })).toBe(false);
  });

  it('runs feature.set-enabled at global as a gateway transaction and replies with the feature write shape', async () => {
    const packages = fakePackages();
    const { transport, audits, post } = await serve({
      packages,
      document: {
        configVersion: 2, plugins: { rss: '@zhin.js/plugin-rss' }, disable_plugins: ['rss'],
        rss: { overrides: { adapters: { qq: { enabled: true } } } },
      },
    });
    const reply = await post('admin-token', { type: 'feature.set-enabled', requestId: 7, data: { plugin: 'rss', level: 'global', enabled: false } });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      success: true, type: 'feature.set-enabled', requestId: 7,
      data: { status: 'saved', revision: 'rev-after', restartRequired: true, message: expect.stringContaining('rss 已停用'), transaction: { id: 'tx1', ok: true } },
    });
    // Computed from the configuration after the write, as the instance did.
    expect(reply.body.data.warnings.map((warning: { code: string }) => warning.code).sort()).toEqual(['enabled-under-disabled', 'unknown-adapter']);
    expect(packages.setEnabled).toHaveBeenCalledOnce();
    expect(packages.setEnabled.mock.calls[0]!.slice(0, 2)).toEqual([{ plugin: 'rss' }, false]);
    expect(packages.setEnabled.mock.calls[0]![2].principal).toMatchObject({ userId: 'admin-token' });
    // Never forwarded: the instance does not write disable_plugins.
    expect(transport.requests).toHaveLength(0);
    expect(audits).toContainEqual(expect.objectContaining({ action: 'rpc:feature.set-enabled', outcome: 'ok' }));
  });

  it('answers unchanged when the plugin already is in the requested state', async () => {
    const packages = fakePackages(transaction({ operation: 'enable', plugin: { instanceKey: 'rss', packageName: '@zhin.js/plugin-rss', enabled: true, changed: false } }));
    const { post } = await serve({ packages });
    const feature = await post('owner-token', { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global', enabled: true } });
    expect(feature.body.data).toMatchObject({ status: 'unchanged', revision: 'rev-after', warnings: [] });
    expect(feature.body.data.restartRequired).toBeUndefined();
    const plugin = await post('owner-token', { type: 'plugin:set-enabled', requestId: 'p', instanceKey: 'rss', enabled: true });
    expect(plugin.body).toMatchObject({
      success: true, type: 'plugin:set-enabled', requestId: 'p',
      data: { success: true, instanceKey: 'rss', enabled: true, restartRequired: false, message: 'rss 已处于启用状态' },
    });
  });

  it('runs plugin:set-enabled as a gateway transaction and replies with its existing shape', async () => {
    const packages = fakePackages();
    const { transport, post } = await serve({ packages });
    const reply = await post('admin-token', { type: 'plugin:set-enabled', requestId: 90, instanceKey: 'rss', enabled: false });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      success: true, type: 'plugin:set-enabled', requestId: 90,
      data: {
        success: true, instanceKey: 'rss', enabled: false, disabled: ['rss'], restartRequired: true,
        message: 'rss 已停用，实例已由管理网关重启', transaction: expect.objectContaining({ id: 'tx1' }),
      },
    });
    expect(packages.setEnabled.mock.calls[0]!.slice(0, 2)).toEqual([{ plugin: 'rss' }, false]);
    expect(transport.requests).toHaveLength(0);
    expect((await post('admin-token', { type: 'plugin:set-enabled', instanceKey: 'rss' })).body)
      .toMatchObject({ success: false, code: 'invalid_input', error: 'instanceKey and boolean enabled are required' });
  });

  it('requires plugin.manage: feature.toggle alone (operators included) is denied without touching anything', async () => {
    const packages = fakePackages();
    const { transport, audits, post } = await serve({ packages });
    for (const token of ['toggle-token', 'operator-token', 'viewer-token']) {
      const feature = await post(token, { type: 'feature.set-enabled', requestId: 1, data: { plugin: 'rss', level: 'global', enabled: false } });
      expect(feature.status, token).toBe(403);
      expect(feature.body).toMatchObject({ success: false, code: 'forbidden', requestId: 1 });
      const plugin = await post(token, { type: 'plugin:set-enabled', instanceKey: 'rss', enabled: false });
      expect(plugin.status, token).toBe(403);
    }
    expect(packages.setEnabled).not.toHaveBeenCalled();
    expect(transport.requests).toHaveLength(0);
    expect(audits.filter(entry => entry.outcome === 'denied').length).toBe(6);
  });

  it('forwards feature.set-enabled below the global level to the instance untouched', async () => {
    const packages = fakePackages();
    const { transport, post } = await serve({ packages });
    const body = { type: 'feature.set-enabled', requestId: 3, data: { plugin: 'rss', level: 'adapter', key: 'qq', enabled: false } };
    const reply = await post('toggle-token', body);
    expect(reply.body).toEqual({ success: true, from: 'instance' });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.body).toBe(JSON.stringify(body));
    expect(transport.requests[0]!.context.principal).toMatchObject({ userId: 'toggle-token' });
    expect(packages.setEnabled).not.toHaveBeenCalled();
  });

  it('maps a rolled-back transaction onto the error envelope with the transaction details', async () => {
    const failed = transaction({ ok: false, status: 'rolledBack', failedPhase: 'start-instance', error: 'Instance did not become ready', logTail: ['boom'], plugin: undefined });
    const { audits, post } = await serve({ packages: fakePackages(failed) });
    const feature = await post('owner-token', { type: 'feature.set-enabled', requestId: 4, data: { plugin: 'rss', level: 'global', enabled: true } });
    expect(feature.status).toBe(500);
    expect(feature.body).toMatchObject({
      success: false, code: 'transaction_failed', type: 'feature.set-enabled', requestId: 4,
      error: '启用 rss 失败，已回滚：Instance did not become ready',
      transaction: { status: 'rolledBack', failedPhase: 'start-instance', logTail: ['boom'] },
    });
    const plugin = await post('owner-token', { type: 'plugin:set-enabled', instanceKey: 'rss', enabled: true });
    expect(plugin.body).toMatchObject({ success: false, code: 'transaction_failed', transaction: { status: 'rolledBack' } });
    expect(audits).toContainEqual(expect.objectContaining({ action: 'rpc:feature.set-enabled', outcome: 'error' }));
  });

  it('reports a rollback that did not complete', async () => {
    const failed = transaction({ ok: false, status: 'rollbackFailed', error: 'start failed', rollbackError: 'restore failed', plugin: undefined });
    const { post } = await serve({ packages: fakePackages(failed) });
    const reply = await post('owner-token', { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global', enabled: false } });
    expect(reply.body).toMatchObject({ success: false, code: 'rollback_failed', error: expect.stringContaining('回滚未完成：restore failed'), transaction: { status: 'rollbackFailed' } });
  });

  it('passes refusals from the transaction through (validation, conflict) with their status', async () => {
    const refused = new GatewayError('invalid_input', '配置未通过插件 Schema 校验，未启用', { details: { errors: [{ path: '$.token', message: 'required' }], missingEnv: ['RSS_TOKEN'] } });
    const { post } = await serve({ packages: fakePackages(refused) });
    const reply = await post('owner-token', { type: 'feature.set-enabled', requestId: 5, data: { plugin: 'rss', level: 'global', enabled: true } });
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ success: false, code: 'invalid_input', requestId: 5, errors: [{ path: '$.token' }], missingEnv: ['RSS_TOKEN'] });
    const busy = await serve({ packages: fakePackages(new GatewayError('conflict', '另一个依赖事务正在进行，请等待它结束')) });
    expect((await busy.post('owner-token', { type: 'plugin:set-enabled', instanceKey: 'rss', enabled: false })).status).toBe(409);
  });

  it('validates the global feature switch payload before running anything', async () => {
    const packages = fakePackages();
    const { post } = await serve({ packages });
    const send = (data: Record<string, unknown>) => post('owner-token', { type: 'feature.set-enabled', data: { level: 'global', ...data } });
    expect((await send({ plugin: 'rss/child', enabled: false })).body).toMatchObject({ success: false, error: '全局开关只适用于顶层插件实例' });
    expect((await send({ plugin: 'rss', key: 'qq', enabled: false })).body).toMatchObject({ success: false, error: 'global 层不需要 key' });
    expect((await send({ plugin: 'rss', enabled: 'no' })).body).toMatchObject({ success: false, error: 'enabled 必须是布尔值' });
    expect((await send({ enabled: true })).status).toBe(400);
    expect(packages.setEnabled).not.toHaveBeenCalled();
  });

  it('refuses (503) instead of forwarding when the gateway manages no packages', async () => {
    const { transport, post } = await serve({ packages: undefined });
    const reply = await post('owner-token', { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global', enabled: false } });
    expect(reply.status).toBe(503);
    expect(reply.body).toMatchObject({ success: false, code: 'unavailable' });
    expect(transport.requests).toHaveLength(0);
  });

  it('reads the revision and override warnings from the project configuration after the write', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-gateway-switch-')));
    dirs.push(root);
    const file = join(root, 'zhin.config.json');
    await writeFile(file, JSON.stringify({ configVersion: 2, plugins: { rss: '@zhin.js/plugin-rss' } }));
    const packages: GatewayPluginSwitchPackages = {
      setEnabled: async () => {
        const document = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        await writeFile(file, JSON.stringify({ ...document, disable_plugins: ['rss'] }));
        return transaction();
      },
    };
    const { post } = await serve({ packages, projectRoot: root });
    const reply = await post('owner-token', { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global', enabled: false } });
    expect(reply.body.data).toMatchObject({ status: 'saved', restartRequired: true, warnings: [] });
    expect(typeof reply.body.data.revision).toBe('string');
    expect(reply.body.data.revision.length).toBeGreaterThan(0);
    const plugin = await post('owner-token', { type: 'plugin:set-enabled', instanceKey: 'rss', enabled: false });
    expect(plugin.body.data.disabled).toEqual(['rss']);
  });
});
