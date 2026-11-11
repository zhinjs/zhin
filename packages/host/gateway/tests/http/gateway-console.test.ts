import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonResponse, type ConsoleAuditEntry, type WsConnection } from '@zhin.js/host-http';
import {
  EMPTY_ROUTE_TABLE,
  type BridgeRouteTable,
  type InstanceRequestContext,
  type InstanceWsOpenInfo,
} from '@zhin.js/host-http/bridge';
import type { ConsolePluginPermissionInfo, GatewayPackageEvent } from '@zhin.js/console-protocol';
import { startGateway, type GatewayInstanceTransport, type RunningGateway } from '../../src/http/start-gateway.js';
import { GatewayHttpServer } from '../../src/http/gateway-http-server.js';
import { registerGatewayEventRoutes } from '../../src/http/gateway-events.js';

const fixture = fileURLToPath(new URL('../supervisor/fixtures/fake-instance.mjs', import.meta.url));
const PASSWORD = 'correct-horse-battery';
const gateways: RunningGateway[] = [];
const servers: GatewayHttpServer[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Bridge stand-in: offline unless `ready`; records forwarded requests, revocations and catalog. */
class FakeInstance implements GatewayInstanceTransport {
  ready = false;
  table: BridgeRouteTable = { revision: 1, apiBase: '/api', http: [{ method: 'ALL', pattern: '/*' }], ws: [] };
  readonly requests: Array<{ path: string; context: InstanceRequestContext; body: string }> = [];
  readonly revoked: Array<{ principalId: string; reason?: string }> = [];
  catalog: readonly ConsolePluginPermissionInfo[] = [];
  readonly #audit = new Set<(entry: ConsoleAuditEntry) => void>();
  readonly #routes = new Set<(table: BridgeRouteTable) => void>();

  routes(): BridgeRouteTable { return this.ready ? this.table : EMPTY_ROUTE_TABLE; }
  onRoutes(listener: (table: BridgeRouteTable) => void): () => void {
    this.#routes.add(listener);
    return () => { this.#routes.delete(listener); };
  }
  setReady(ready: boolean): void {
    this.ready = ready;
    for (const listener of [...this.#routes]) listener(this.routes());
  }
  async fetch(request: Request, context: InstanceRequestContext = {}): Promise<Response> {
    const path = new URL(request.url).pathname;
    this.requests.push({ path, context, body: request.body ? await request.text() : '' });
    return jsonResponse(200, { from: 'instance', path, principal: context.principal ?? null });
  }
  async openWebSocket(_info: InstanceWsOpenInfo, _peer: WsConnection): Promise<boolean> { return false; }
  pluginPermissions(): readonly ConsolePluginPermissionInfo[] { return this.catalog; }
  revokePrincipal(principalId: string, reason?: string): void { this.revoked.push({ principalId, ...(reason ? { reason } : {}) }); }
  onAudit(listener: (entry: ConsoleAuditEntry) => void): () => void {
    this.#audit.add(listener);
    return () => { this.#audit.delete(listener); };
  }
  emitAudit(entry: ConsoleAuditEntry): void { for (const listener of [...this.#audit]) listener(entry); }
}

async function gatewayOnly(options: { token?: string; config?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-gateway-console-'));
  dirs.push(root);
  await writeFile(join(root, 'zhin.config.yml'), options.config ?? 'configVersion: 2\nplugins: {}\n');
  const instance = new FakeInstance();
  const gateway = await startGateway({
    projectRoot: root,
    http: { host: '127.0.0.1', port: 0, ...(options.token ? { token: options.token } : {}) },
    supervisor: { spawn: { command: process.execPath, args: [fixture], cwd: root } },
    transport: () => instance,
    // No instance process at all: the Console must work on the gateway alone.
    startInstance: false,
    packages: false,
  });
  gateways.push(gateway);
  const origin = gateway.http.address!.origin;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
  };
  const rpc = (type: string, data: Record<string, unknown>, token?: string) => call('POST', '/console/request', { type, data, requestId: 'r1' }, token);
  return { root, instance, gateway, origin, call, rpc };
}

async function signedInOwner(context: Awaited<ReturnType<typeof gatewayOnly>>, token: string): Promise<string> {
  const created = await context.call('POST', '/auth/setup', { username: 'owner', password: PASSWORD }, token);
  expect(created.status).toBe(201);
  return created.body.data.token as string;
}

describe('gateway Console access control without an instance (B1.4)', () => {
  it('initializes the project database, signs in and serves /auth/me while instance routes answer 503', async () => {
    const context = await gatewayOnly({ token: 'setup-token' });
    // Before setup: bootstrap token only.
    const anonymous = await context.call('GET', '/auth/me');
    expect(anonymous.body.data).toMatchObject({ kind: 'anonymous', setupRequired: true });
    const setup = await context.call('GET', '/auth/setup', undefined, 'setup-token');
    expect(setup.status).toBe(200);
    expect(setup.body.data).toMatchObject({
      setupRequired: true,
      database: { dialect: 'sqlite', source: 'default' },
      onboarding: { version: 1, steps: { owner: 'pending' }, required: true },
    });
    expect((await context.call('GET', '/auth/setup/database', undefined, 'setup-token')).body.data.drivers.length).toBeGreaterThan(0);

    const session = await signedInOwner(context, 'setup-token');
    // The bootstrap token is refused from now on.
    expect((await context.call('GET', '/auth/setup', undefined, 'setup-token')).status).toBe(401);
    expect((await context.call('POST', '/auth/login', { username: 'owner', password: 'wrong-password-123' })).status).toBe(401);
    const login = await context.call('POST', '/auth/login', { username: 'owner', password: PASSWORD });
    expect(login.status).toBe(200);
    const me = await context.call('GET', '/auth/me', undefined, login.body.data.token);
    expect(me.body.data).toMatchObject({
      kind: 'user',
      user: { username: 'owner' },
      setupRequired: false,
      onboarding: { steps: { owner: 'done' } },
    });
    expect(me.body.data.permissions).toContain('plugin.manage');

    // Gateway RPC works; instance routes do not exist without an instance.
    const users = await context.rpc('iam.users.list', {}, session);
    expect(users.status).toBe(200);
    expect(users.body.data.users.map((user: { username: string }) => user.username)).toEqual(['owner']);
    expect((await context.rpc('gateway.instance.status', {}, session)).body.data).toMatchObject({ instanceId: 'default', state: 'stopped' });
    const forwarded = await context.rpc('system:status', {}, session);
    expect(forwarded.status).toBe(503);
    expect(forwarded.body).toMatchObject({ code: 'instance_unavailable' });
    expect((await context.call('GET', '/system/status', undefined, session)).status).toBe(503);
    // `/auth/*` is never forwarded: unmapped methods / paths are refused by the permission map.
    expect((await context.call('GET', '/auth/login', undefined, session)).status).toBe(403);
    expect(context.instance.requests).toHaveLength(0);

    // The audit log lives in the gateway database.
    const audit = await context.rpc('iam.audit.list', {}, session);
    expect(audit.body.data.entries.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining(['auth.setup', 'auth.login']));
  });

  it('opens an owner-less project as an open Host (no http.token) and refuses http.token after setup', async () => {
    const context = await gatewayOnly();
    context.instance.setReady(true);
    expect((await context.call('GET', '/auth/me')).body.data).toMatchObject({ kind: 'bootstrap', open: true, onboarding: { required: true } });
    // Open Host: authorization passes, yet unknown `/auth/*` paths stay at the gateway.
    expect((await context.call('GET', '/auth/unknown')).status).toBe(404);
    expect(context.instance.requests).toHaveLength(0);
    // An open Host may create the owner; afterwards everything needs an account.
    const created = await context.call('POST', '/auth/setup', { username: 'owner', password: PASSWORD });
    expect(created.status).toBe(201);
    expect((await context.rpc('iam.users.list', {})).status).toBe(401);
  });

  it('forwards the locally authenticated principal and reports revocations, instance audit and the plugin catalog', async () => {
    const context = await gatewayOnly({ token: 'setup-token' });
    const session = await signedInOwner(context, 'setup-token');
    context.instance.catalog = [{ id: 'ambient:read', level: 'read', declared: true, owners: ['root/ambient'] }];
    context.instance.setReady(true);

    const forwarded = await context.rpc('system:status', { a: 1 }, session);
    expect(forwarded.status).toBe(200);
    expect(forwarded.body).toMatchObject({ from: 'instance', principal: { kind: 'user', username: 'owner', roles: ['owner'] } });
    expect(JSON.parse(context.instance.requests[0]!.body)).toMatchObject({ type: 'system:status', data: { a: 1 } });
    // iam.* never reaches the instance.
    const roles = await context.rpc('iam.roles.list', {}, session);
    expect(roles.body.data.pluginPermissions).toEqual([expect.objectContaining({ permission: 'ambient:read', level: 'read' })]);
    expect(context.instance.requests.map((request) => request.path)).toEqual(['/api/console/request']);

    // A user, then disabled: the instance is told to drop the user's live connections.
    const created = await context.rpc('iam.users.create', { username: 'viewer', password: PASSWORD, bindings: [{ role: 'viewer' }] }, session);
    expect(created.status).toBe(200);
    const viewerId = created.body.data.user.id as string;
    const viewer = (await context.call('POST', '/auth/login', { username: 'viewer', password: PASSWORD })).body.data.token as string;
    expect((await context.rpc('iam.users.delete', { id: 'nobody' }, viewer)).status).toBe(403);
    expect((await context.rpc('iam.users.disable', { id: viewerId }, session)).status).toBe(200);
    expect(context.instance.revoked).toEqual([{ principalId: viewerId, reason: 'disabled' }]);
    expect((await context.call('GET', '/auth/me', undefined, viewer)).body.data.kind).toBe('anonymous');

    // Audit written by the instance lands in the gateway's log.
    context.instance.emitAudit({ actor: 'user:x', action: 'rpc:config:patch', outcome: 'denied' });
    const audit = await context.rpc('iam.audit.list', { action: 'rpc:config:patch' }, session);
    expect(audit.body.data.entries).toEqual([expect.objectContaining({ actor: 'user:x', outcome: 'denied' })]);
    const denied = await context.rpc('iam.audit.list', { action: 'rpc:iam.users.delete' }, session);
    expect(denied.body.data.entries).toEqual([expect.objectContaining({ actor: `user:${viewerId}`, outcome: 'denied' })]);
  });

  it('answers onboarding.update with the step permissions of ADR 0053 §2', async () => {
    const context = await gatewayOnly({ token: 'setup-token' });
    const session = await signedInOwner(context, 'setup-token');
    // The Console sends `{ type, step, status }` at the top level.
    const skipped = await context.call('POST', '/console/request', { type: 'onboarding.update', step: 'ai', status: 'skipped', requestId: 1 }, session);
    expect(skipped.status).toBe(200);
    expect(skipped.body).toMatchObject({ success: true, requestId: 1, data: { steps: { ai: 'skipped', owner: 'done' } } });
    expect((await context.rpc('onboarding.update', { step: 'adapters', status: 'done' }, session)).body.data.steps.adapters).toBe('done');
    expect((await context.rpc('onboarding.update', { step: 'owner', status: 'done' }, session)).status).toBe(400);
    expect((await context.rpc('onboarding.update', { step: 'ai', status: 'later' }, session)).status).toBe(400);
    const finished = await context.rpc('onboarding.update', { step: 'finish' }, session);
    expect(finished.body.data).toMatchObject({ required: false, completedAt: expect.any(String) });

    // plugin.manage alone may not configure AI or adapters.
    await context.rpc('iam.roles.create', { name: 'installer', permissions: ['plugin.manage'] }, session);
    await context.rpc('iam.users.create', { username: 'installer', password: PASSWORD, bindings: [{ role: 'installer' }] }, session);
    const installer = (await context.call('POST', '/auth/login', { username: 'installer', password: PASSWORD })).body.data.token as string;
    expect((await context.call('GET', '/auth/me', undefined, installer)).body.data.onboarding).toMatchObject({ required: false });
    const ai = await context.rpc('onboarding.update', { step: 'ai', status: 'done' }, installer);
    expect(ai.status).toBe(403);
    expect(ai.body.error).toContain('agent.configure');
    expect((await context.rpc('onboarding.update', { step: 'adapters', status: 'done' }, installer)).body.error).toContain('endpoint.manage');
    // Without plugin.manage the RPC is refused by the permission map.
    await context.rpc('iam.users.create', { username: 'watcher', password: PASSWORD, bindings: [{ role: 'viewer' }] }, session);
    const watcher = (await context.call('POST', '/auth/login', { username: 'watcher', password: PASSWORD })).body.data.token as string;
    expect((await context.rpc('onboarding.update', { step: 'finish' }, watcher)).status).toBe(403);
    expect((await context.call('GET', '/auth/me', undefined, watcher)).body.data.onboarding).toBeUndefined();
  });
});

describe('gateway Console event stream', () => {
  class Progress {
    readonly listeners = new Set<(event: GatewayPackageEvent) => void>();
    subscribe(listener: (event: GatewayPackageEvent) => void): () => void {
      this.listeners.add(listener);
      return () => { this.listeners.delete(listener); };
    }
    emit(event: GatewayPackageEvent): void { for (const listener of [...this.listeners]) listener(event); }
  }

  async function serve(instance: FakeInstance, handler?: (request: Request) => Response) {
    if (handler) instance.fetch = async (request) => handler(request);
    const server = new GatewayHttpServer({
      http: { host: '127.0.0.1', port: 0 },
      instance: { transport: () => instance, state: () => (instance.ready ? 'running' : 'stopped') },
    });
    servers.push(server);
    const progress = new Progress();
    registerGatewayEventRoutes({ server, packages: progress, instance: { onChange: (listener) => instance.onRoutes(() => listener()) } });
    await server.listen();
    return { origin: server.address!.origin, progress };
  }

  async function readUntil(reader: ReadableStreamDefaultReader<string>, needle: string): Promise<string> {
    let text = '';
    while (!text.includes(needle)) {
      const next = await reader.read();
      if (next.done) throw new Error(`stream ended before ${needle}: ${text}`);
      text += next.value;
    }
    return text;
  }

  it('streams package progress while the instance is offline and closes once it is back', async () => {
    const instance = new FakeInstance();
    const { origin, progress } = await serve(instance);
    const history = await (await fetch(`${origin}/api/events/history?runtimeId=r1&after=7`)).json();
    expect(history).toEqual({ success: true, data: expect.objectContaining({ runtimeId: 'r1', items: [], latestEventId: 7, hasMore: false, gap: false }) });
    const response = await fetch(`${origin}/api/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    await readUntil(reader, ': gateway');
    progress.emit({ type: 'phase', id: 'tx1', phase: 'package-manager' });
    expect(await readUntil(reader, 'package-manager')).toContain('event: gateway.packages.progress\ndata: {"type":"phase","id":"tx1","phase":"package-manager"}\n\n');
    instance.setReady(true);
    for (;;) if ((await reader.read()).done) break;
  });

  it('splices gateway frames between the instance’s SSE frames', async () => {
    const instance = new FakeInstance();
    instance.ready = true;
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const { origin, progress } = await serve(instance, () => new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } }), {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const response = await fetch(`${origin}/api/events`);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    upstream.enqueue(encoder.encode('id: 1\nevent: hmr:reload\nda'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Mid-frame: the gateway frame waits for the boundary.
    progress.emit({ type: 'phase', id: 'tx1', phase: 'done' });
    upstream.enqueue(encoder.encode('ta: {"generation":2}\n\n'));
    const text = await readUntil(reader, '"phase":"done"');
    expect(text).toBe('id: 1\nevent: hmr:reload\ndata: {"generation":2}\n\nevent: gateway.packages.progress\ndata: {"type":"phase","id":"tx1","phase":"done"}\n\n');
    // The merged stream ends with the instance's.
    upstream.close();
    for (;;) if ((await reader.read()).done) break;
  });

  it('serves the progress stream alone on {base}/gateway/packages/progress', async () => {
    const { origin, progress } = await serve(new FakeInstance());
    const response = await fetch(`${origin}/api/gateway/packages/progress`);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    await readUntil(reader, ': gateway packages');
    progress.emit({ type: 'output', id: 'tx1', stream: 'stdout', chunk: 'added 1 package' });
    expect(await readUntil(reader, 'added 1 package')).toContain('event: gateway.packages.progress');
    await reader.cancel();
  });
});
