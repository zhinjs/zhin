import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConsolePrincipal } from '@zhin.js/host-http';
import { GATEWAY_RPC } from '@zhin.js/console-protocol';
import {
  createGatewayRpcDispatcher,
  dispatchGatewayRpc,
  GatewayPackageService,
  isGatewayRpcType,
  type GatewayRpcInstance,
} from '../../src/packages/index.js';
import type { InstanceState, InstanceStatus } from '../../src/supervisor/instance-supervisor.js';
import { PluginDeclarationError } from '../../src/plugin-management/workflow.js';
import { noPermissionUser, testUser } from '../utils/console-users.js';

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-gateway-rpc-')));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', version: '1.0.0', dependencies: { pg: '^8.0.0' } }));
  await mkdir(join(root, 'node_modules/pg'), { recursive: true });
  await writeFile(join(root, 'node_modules/pg/package.json'), JSON.stringify({ name: 'pg', version: '8.1.0' }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

class FakeSupervisor implements GatewayRpcInstance {
  state: InstanceState = 'running';
  readonly calls: string[] = [];
  failStart = false;
  readonly logs = { tail: (limit = 1000) => Array.from({ length: Math.min(limit, 3) }, (_, seq) => ({ seq, time: seq, stream: 'stdout' as const, line: `line ${seq}` })) };
  status(): InstanceStatus { return { state: this.state, pid: 42, lastExitCode: null, lastExitSignal: null, recentRestarts: 0 }; }
  async start() { this.calls.push('start'); if (this.failStart) throw new Error('Instance did not report ready'); this.state = 'running'; }
  async stop() { this.calls.push('stop'); this.state = 'stopped'; }
  async restart() { this.calls.push('restart'); this.state = 'running'; }
  on() { return this; }
  off() { return this; }
}

function setup() {
  const instance = new FakeSupervisor();
  const packages = new GatewayPackageService({ projectRoot: root, hasOwner: () => true, instance, packageManager: async () => undefined });
  return { instance, packages, dispatch: createGatewayRpcDispatcher({ instance, packages }) };
}

describe('dispatchGatewayRpc', () => {
  it('recognizes only gateway RPC types', async () => {
    expect(isGatewayRpcType('gateway.instance.status')).toBe(true);
    expect(isGatewayRpcType('config:get')).toBe(false);
    const { dispatch } = setup();
    expect(await dispatch({ type: 'gateway.instance.reboot' }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'unmapped', status: 403 } });
  });

  it('enforces the permission map per role', async () => {
    const { dispatch, instance } = setup();
    const matrix: readonly [string, ConsolePrincipal | 'local' | undefined, boolean][] = [
      [GATEWAY_RPC.STATUS, testUser('viewer'), true],
      [GATEWAY_RPC.STATUS, noPermissionUser(), false],
      [GATEWAY_RPC.STATUS, undefined, false],
      [GATEWAY_RPC.LOGS, testUser('operator'), true],
      [GATEWAY_RPC.RESTART, testUser('operator'), false],
      [GATEWAY_RPC.RESTART, testUser('viewer'), false],
      [GATEWAY_RPC.RESTART, testUser('admin'), true],
      [GATEWAY_RPC.STOP, testUser('owner'), true],
      [GATEWAY_RPC.START, 'local', true],
      [GATEWAY_RPC.START, { kind: 'bootstrap', open: false }, false],
      [GATEWAY_RPC.LIST, testUser('viewer'), true],
      [GATEWAY_RPC.LIST, noPermissionUser(), false],
    ];
    for (const [type, principal, allowed] of matrix) {
      const response = await dispatch({ type }, principal);
      expect(response.ok, `${type} ${typeof principal === 'object' ? principal.kind === 'bootstrap' ? 'bootstrap' : principal.username : String(principal)}`).toBe(allowed);
      if (!allowed) expect(response).toMatchObject({ ok: false, error: { code: 'forbidden', status: 403 } });
    }
    expect(instance.calls).toEqual(['restart', 'stop', 'start']);
  });

  it('returns status, logs and lifecycle results', async () => {
    const { dispatch, instance } = setup();
    expect(await dispatch({ type: GATEWAY_RPC.STATUS }, testUser('viewer'))).toEqual({ ok: true, data: { instanceId: 'default', state: 'running', pid: 42, lastExitCode: null, lastExitSignal: null, recentRestarts: 0 } });
    expect(await dispatch({ type: GATEWAY_RPC.LOGS, data: { lines: 2 } }, testUser('viewer'))).toMatchObject({ ok: true, data: { lines: [{ line: 'line 0' }, { line: 'line 1' }] } });
    expect(await dispatch({ type: GATEWAY_RPC.LOGS, data: { lines: 0 } }, testUser('viewer'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch({ type: GATEWAY_RPC.STOP }, testUser('admin'))).toMatchObject({ ok: true, data: { state: 'stopped' } });
    instance.failStart = true;
    expect(await dispatch({ type: GATEWAY_RPC.START }, testUser('admin'))).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'Instance did not report ready' } });
  });

  it('dispatches package RPC to the service and validates payloads', async () => {
    const { dispatch } = setup();
    expect(await dispatch({ type: GATEWAY_RPC.LIST }, testUser('viewer'))).toMatchObject({ ok: true, data: { packages: [{ name: 'pg', installedVersion: '8.1.0' }] } });
    expect(await dispatch({ type: GATEWAY_RPC.PLAN, data: { operation: 'update', packages: 'all' } }, testUser('owner'))).toMatchObject({ ok: true, data: { all: true, restartsInstance: true } });
    expect(await dispatch({ type: GATEWAY_RPC.PLAN, data: { operation: 'update', packages: 'all' } }, testUser('admin'))).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatch({ type: GATEWAY_RPC.PLAN, data: { operation: 'delete', packages: [] } }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch({ type: GATEWAY_RPC.INSTALL, data: { packages: 'pg' } }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch({ type: GATEWAY_RPC.INSTALL, data: { packages: ['pg'], enable: 'yes' } }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch({ type: GATEWAY_RPC.UNINSTALL, data: { packages: ['pg'] } }, testUser('operator'))).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('returns structured schema errors and missing environment variables for a refused declaration', async () => {
    const errors = [{ path: '$.endpoints.0.id', message: '缺少必填项' }];
    const packages = new GatewayPackageService({ projectRoot: root, hasOwner: () => true, instance: new FakeSupervisor(), stableMs: 0, packageManager: async () => undefined,
      workflow: { inspect: async () => ({ declared: false }), install: async () => undefined, uninstall: async () => undefined, update: async () => undefined,
        planDeclaration: async () => { throw new PluginDeclarationError('配置未通过插件 Schema 校验，未声明：$.endpoints.0.id 缺少必填项；缺少环境变量 BOT_TOKEN', errors, ['BOT_TOKEN']); },
        declare: async () => undefined } });
    const dispatch = createGatewayRpcDispatcher({ packages });
    const reply = await dispatch({ type: GATEWAY_RPC.DECLARE, data: { package: '@zhin.js/adapter-sandbox', config: {} } }, testUser('owner'));
    expect(reply).toEqual({ ok: false, error: { code: 'invalid_input', status: 400,
      message: '配置未通过插件 Schema 校验，未声明：$.endpoints.0.id 缺少必填项；缺少环境变量 BOT_TOKEN', errors, missingEnv: ['BOT_TOKEN'] } });
    // Errors without details keep the plain shape.
    expect(await dispatch({ type: GATEWAY_RPC.DECLARE, data: { config: {} } }, testUser('owner')))
      .toEqual({ ok: false, error: { code: 'invalid_input', status: 400, message: expect.any(String) } });
  });

  it('dispatches gateway.plugins.declare with plugin.manage and validates its payload', async () => {
    const calls: unknown[][] = [];
    const instance = new FakeSupervisor();
    const packages = new GatewayPackageService({ projectRoot: root, hasOwner: () => true, instance, stableMs: 0, packageManager: async () => undefined,
      workflow: { inspect: async () => ({ declared: false }), install: async () => undefined, uninstall: async () => undefined, update: async () => undefined,
        planDeclaration: async (...args) => { calls.push(['plan', ...args]); }, declare: async (...args) => { calls.push(['declare', ...args]); } } });
    const dispatch = createGatewayRpcDispatcher({ instance, packages });
    const data = { package: '@zhin.js/adapter-sandbox', config: { endpoints: [{ id: 'bot' }] } };
    expect(await dispatch({ type: GATEWAY_RPC.DECLARE, data }, testUser('operator'))).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatch({ type: GATEWAY_RPC.DECLARE, data }, { kind: 'bootstrap', open: false })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatch({ type: GATEWAY_RPC.DECLARE, data: { ...data, config: [] } }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch({ type: GATEWAY_RPC.DECLARE, data: { config: {} } }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(calls).toEqual([]);
    expect(await dispatch({ type: GATEWAY_RPC.DECLARE, data: { ...data, instanceKey: 'sandbox' } }, testUser('admin')))
      .toMatchObject({ ok: true, data: { ok: true, operation: 'declare', packages: [{ name: '@zhin.js/adapter-sandbox', source: 'adapter' }] } });
    expect(calls).toEqual([
      ['plan', '@zhin.js/adapter-sandbox', data.config, { instanceKey: 'sandbox' }],
      ['declare', '@zhin.js/adapter-sandbox', data.config, { instanceKey: 'sandbox' }],
    ]);
    expect(instance.calls).toEqual(['stop', 'start']);
  });

  it('dispatches gateway.plugins.enable / disable with plugin.manage', async () => {
    const calls: unknown[][] = [];
    const instance = new FakeSupervisor();
    const packages = new GatewayPackageService({ projectRoot: root, hasOwner: () => true, instance, stableMs: 0, packageManager: async () => undefined,
      workflow: { inspect: async () => ({ declared: true }), install: async () => undefined, uninstall: async () => undefined, update: async () => undefined,
        planSetEnabled: async (request, enabled) => { calls.push(['plan', request, enabled]); return { packageName: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', changed: request !== 'unchanged' }; },
        setEnabled: async (...args) => { calls.push(['set', ...args]); } } });
    const dispatch = createGatewayRpcDispatcher({ instance, packages });
    expect(await dispatch({ type: GATEWAY_RPC.DISABLE, data: { plugin: 'sandbox' } }, testUser('operator'))).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatch({ type: GATEWAY_RPC.DISABLE, data: { plugin: 'sandbox' } }, { kind: 'bootstrap', open: false })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatch({ type: GATEWAY_RPC.DISABLE, data: {} }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch({ type: GATEWAY_RPC.DISABLE, data: { plugin: 'sandbox', startInstance: 'yes' } }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(calls).toEqual([]);
    expect(await dispatch({ type: GATEWAY_RPC.DISABLE, data: { plugin: 'sandbox' } }, testUser('admin')))
      .toMatchObject({ ok: true, data: { ok: true, operation: 'disable', packages: [{ name: '@zhin.js/adapter-sandbox', source: 'adapter' }], plugin: { instanceKey: 'sandbox', enabled: false, changed: true } } });
    expect(await dispatch({ type: GATEWAY_RPC.ENABLE, data: { plugin: 'unchanged' } }, testUser('admin')))
      .toMatchObject({ ok: true, data: { ok: true, operation: 'enable', plugin: { enabled: true, changed: false } } });
    expect(calls).toEqual([['plan', 'sandbox', false], ['set', 'sandbox', false], ['plan', 'unchanged', true]]);
    expect(instance.calls).toEqual(['stop', 'start']);
  });

  it('lets the bootstrap token plan database drivers only', async () => {
    const packages = new GatewayPackageService({ projectRoot: root, hasOwner: () => false, packageManager: async () => undefined });
    const bootstrap: ConsolePrincipal = { kind: 'bootstrap', open: false };
    expect(await dispatchGatewayRpc({ type: GATEWAY_RPC.PLAN, data: { operation: 'install', packages: ['mysql2'] } }, bootstrap, { packages }))
      .toMatchObject({ ok: true, data: { packages: [{ name: 'mysql2', source: 'database-driver' }], instanceState: 'unmanaged' } });
    expect(await dispatchGatewayRpc({ type: GATEWAY_RPC.PLAN, data: { operation: 'install', packages: ['@zhin.js/agent'] } }, bootstrap, { packages }))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await dispatchGatewayRpc({ type: GATEWAY_RPC.UNINSTALL, data: { packages: ['mysql2'] } }, bootstrap, { packages }))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses lifecycle RPC while a transaction owns the instance and hides unexpected errors', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolvePromise => { release = resolvePromise; });
    const instance = new FakeSupervisor();
    const packages = new GatewayPackageService({ projectRoot: root, hasOwner: () => true, instance, stableMs: 0, packageManager: async () => { await gate; },
      workflow: { inspect: async () => ({ declared: false }), install: async () => { await gate; }, uninstall: async () => undefined, update: async () => undefined } });
    const dispatch = createGatewayRpcDispatcher({ instance, packages });
    const running = dispatch({ type: GATEWAY_RPC.INSTALL, data: { packages: ['pg'] } }, testUser('owner'));
    await vi.waitFor(() => expect(packages.activeTransaction).toBeDefined());
    expect(await dispatch({ type: GATEWAY_RPC.RESTART }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'conflict', status: 409 } });
    expect(await dispatch({ type: GATEWAY_RPC.INSTALL, data: { packages: ['zod'] } }, testUser('owner'))).toMatchObject({ ok: false, error: { code: 'conflict' } });
    release();
    expect(await running).toMatchObject({ ok: true, data: { status: 'succeeded' } });

    const broken = new GatewayPackageService({ projectRoot: join(root, 'missing'), hasOwner: () => true });
    expect(await dispatchGatewayRpc({ type: GATEWAY_RPC.LIST }, testUser('owner'), { packages: broken }))
      .toEqual({ ok: false, error: { code: 'internal', message: '网关内部错误', status: 500 } });
    expect(await dispatchGatewayRpc({ type: GATEWAY_RPC.STATUS }, testUser('owner'), {})).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
