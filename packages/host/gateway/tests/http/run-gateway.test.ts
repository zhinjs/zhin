import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseStartOptions } from '@zhin.js/runtime';
import { runGateway } from '../../src/http/run-gateway.js';
import { ProjectDatabase } from '../../src/database/project-database.js';
import { ConsoleIamService } from '../../src/iam/service.js';
import { defineConsoleIamTables } from '../../src/iam/tables.js';

const fixture = fileURLToPath(new URL('./fixtures/gateway-instance.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../../../../node_modules/tsx/dist/esm/index.mjs', import.meta.url));
const dirs: string[] = [];
const savedNodeOptions = process.env.NODE_OPTIONS;

afterEach(async () => {
  if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = savedNodeOptions;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function until<T>(probe: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch { /* not up yet */ }
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const PASSWORD = 'correct-horse-battery';

/** Seeds the project database the way `zhin console init` does (the gateway is not running). */
async function seedAccounts(root: string): Promise<void> {
  const database = new ProjectDatabase({ dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') });
  defineConsoleIamTables(database);
  await database.start();
  const iam = new ConsoleIamService({ database, projectRoot: root });
  try {
    await iam.start({ timers: false });
    await iam.createOwner({ username: 'owner', password: PASSWORD });
    await iam.createUser({ username: 'viewer', password: PASSWORD, bindings: [{ role: 'viewer' }] });
  } finally {
    iam.stop();
    await database.stop();
  }
}

async function start(owner: boolean): Promise<{ origin: string; exit: Promise<number> }> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-run-gateway-'));
  dirs.push(root);
  const port = await freePort();
  await writeFile(join(root, 'zhin.config.yml'), `http:\n  host: 127.0.0.1\n  port: ${port}\n`);
  if (owner) await seedAccounts(root);
  // The supervised child resolves workspace sources and runs TypeScript like `pnpm dev` does.
  process.env.NODE_OPTIONS = `--conditions=development --import=${tsx}`;
  const args = ['runtime', 'start', '--once'];
  const exit = runGateway({ root, options: parseStartOptions(args.slice(2)), entry: fixture, args });
  return { origin: `http://127.0.0.1:${port}`, exit };
}

describe('runGateway (zhin runtime start, supervised)', () => {
  it('answers instance routes on the http port and forwards an open (pre-setup) principal', async () => {
    const { origin, exit } = await start(false);
    const hello = await until(async () => {
      const response = await fetch(`${origin}/hello`);
      return response.status === 200 ? response.json() as Promise<{ hello: string; origin: string }> : undefined;
    });
    expect(hello.hello).toBe('instance');
    // The gateway told the instance where it listens (HttpHost.address).
    expect(hello.origin).toBe(origin);
    const health = await (await fetch(`${origin}/pub/health`)).json() as { instance: { state: string; ready: boolean } };
    expect(health.instance).toEqual({ state: 'running', ready: true });

    // No owner, no http.token: the gateway forwards { kind: 'bootstrap', open: true } (B1.2 contract).
    const rpc = await fetch(`${origin}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'system:status', requestId: 'r1', data: { a: 1 } }),
    });
    expect(rpc.status).toBe(200);
    expect(await rpc.json()).toMatchObject({
      forwarded: { type: 'system:status', requestId: 'r1', data: { a: 1 } },
      principal: { kind: 'bootstrap', open: true },
    });
    // gateway.* RPC is answered by the gateway itself.
    const status = await fetch(`${origin}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'gateway.instance.status', requestId: 'r2' }),
    });
    expect(await status.json()).toMatchObject({ success: true, type: 'gateway.instance.status', requestId: 'r2', data: { instanceId: 'default', state: 'running' } });

    expect((await fetch(`${origin}/exit`, { method: 'POST' })).status).toBe(202);
    expect(await exit).toBe(0);
    // The gateway closed its listener with the run.
    await expect(fetch(`${origin}/pub/health`)).rejects.toThrow();
  }, 60_000);

  it('authenticates accounts in the gateway, forwards the principal and revokes live instance streams', async () => {
    const { origin, exit } = await start(true);
    await until(async () => ((await fetch(`${origin}/hello`)).status === 200 ? true : undefined));
    const headers = { 'content-type': 'application/json' };
    const login = async (username: string) => {
      const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username, password: PASSWORD }) });
      expect(response.status).toBe(200);
      return ((await response.json()) as { data: { token: string; user: { id: string } } }).data;
    };
    const rpc = async (token: string | undefined, type: string, data: Record<string, unknown> = {}) => {
      const response = await fetch(`${origin}/api/console/request`, {
        method: 'POST',
        headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ type, requestId: 'r1', data }),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    // An owner exists in the gateway database: no open Host.
    expect((await rpc(undefined, 'system:status')).status).toBe(401);
    expect((await rpc('wrong', 'system:status')).status).toBe(401);
    const owner = await login('owner');
    const viewer = await login('viewer');
    const forwarded = await rpc(owner.token, 'system:status');
    expect(forwarded.status).toBe(200);
    expect(forwarded.body).toMatchObject({ principal: { kind: 'user', userId: owner.user.id, username: 'owner', roles: ['owner'] } });
    // gateway.* payloads travel under `data`.
    const invalid = await rpc(owner.token, 'gateway.instance.logs', { lines: 0 });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ success: false, code: 'invalid_input' });

    // The plugin catalog the instance reported expands `/auth/me` and the role editor.
    const catalog = await until(async () => {
      const roles = await rpc(owner.token, 'iam.roles.list');
      const permissions = roles.body.data.pluginPermissions as Array<{ permission: string }>;
      return permissions.some((entry) => entry.permission === 'fixture:read') ? permissions : undefined;
    });
    expect(catalog).toContainEqual(expect.objectContaining({ permission: 'fixture:read', plugin: 'fixture', level: 'read' }));

    // Denials at the gateway and audit entries from the instance land in the gateway's log.
    expect((await rpc(viewer.token, 'gateway.instance.restart')).status).toBe(403);
    expect((await rpc(owner.token, 'system:audit')).status).toBe(200);
    const audited = await until(async () => {
      const { body } = await rpc(owner.token, 'iam.audit.list', { limit: 100 });
      const entries = body.data.entries as Array<{ action: string; outcome: string; actor: string }>;
      return entries.some((entry) => entry.action === 'rpc:system:audit') ? entries : undefined;
    });
    expect(audited).toContainEqual(expect.objectContaining({ actor: `user:${viewer.user.id}`, action: 'rpc:gateway.instance.restart', outcome: 'denied' }));
    expect(audited).toContainEqual(expect.objectContaining({ actor: 'instance', action: 'rpc:system:audit', outcome: 'ok' }));

    // The viewer's instance SSE stream (merged by the gateway) ends when the owner disables them.
    const events = await fetch(`${origin}/api/events`, { headers: { authorization: `Bearer ${viewer.token}` } });
    expect(events.status).toBe(200);
    const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    while (!text.includes('event: hello')) text += (await reader.read()).value ?? '';
    expect(text).toContain('"user":"viewer"');
    expect((await rpc(owner.token, 'iam.users.disable', { id: viewer.user.id })).status).toBe(200);
    const ended = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5_000);
      void (async () => {
        try { for (;;) if ((await reader.read()).done) break; } catch { /* aborted by the instance */ }
        clearTimeout(timer);
        resolve(true);
      })();
    });
    expect(ended).toBe(true);
    expect((await rpc(viewer.token, 'system:status')).status).toBe(401);

    expect((await fetch(`${origin}/exit`, { method: 'POST' })).status).toBe(202);
    expect(await exit).toBe(0);
  }, 60_000);
});
