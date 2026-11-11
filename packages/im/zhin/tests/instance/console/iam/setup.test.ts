import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { createConsoleEventHub, createHttpHost, type ProcessHttpHost } from '@zhin.js/host-http';
import { createConfigDocument, createPluginLifecycleStore, resolvePluginLifecycleFile } from '@zhin.js/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { ConsoleConfigurationStore } from '../../../../../../host/gateway/src/config/configuration.js';
import { installConsoleIam } from '../../../../../../host/gateway/src/iam/install.js';
import { ConsoleSetupService, upsertDotenv } from '../../../../../../host/gateway/src/iam/setup-service.js';
import { registerConsoleRpcRoute } from '../../../../src/instance/console/rpc-route.js';
import { consoleUserActions, runConsoleInit, type ConsoleCliIo } from '../../../../../../../basic/cli/src/commands/console.js';

const PASSWORD = 'correct-horse-battery';
const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function project(config = 'configVersion: 2\nplugins: {}\n'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-setup-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'setup-fixture', type: 'module' }));
  await writeFile(join(root, 'zhin.config.yml'), config);
  return root;
}

/** The real start path wiring: process DB + installConsoleIam + RPC route on one HTTP Host. */
async function startHost(root: string, options: { token?: string } = {}) {
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') } as never);
  const http: ProcessHttpHost = createHttpHost({ host: '127.0.0.1', port: 0, ...(options.token ? { token: options.token } : {}) });
  const configStore = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.yml')) });
  const requestRestart = vi.fn();
  const iam = installConsoleIam(http, { database, configStore, projectRoot: root, requestRestart });
  registerConsoleRpcRoute({ http, base: '/api', projectRoot: root, consoleRuntime: { runView: async () => ({ pages: [] }) } as unknown as ConsoleRuntime,
    hub: createConsoleEventHub(), pluginLifecycleFile: resolvePluginLifecycleFile(root), pluginLifecycleStore: createPluginLifecycleStore(root),
    configuration: configStore, consoleIam: () => iam.service,
  } as Parameters<typeof registerConsoleRpcRoute>[0]);
  http.route('GET', '/api/system/status', (_request, response) => { response.end('{"ok":true}'); });
  await database.start();
  await iam.activate();
  const { origin } = await http.listen();
  closers.push(async () => { iam.dispose(); await http.close(); await database.stop(); });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const rpc = (type: string, data: Record<string, unknown>, token?: string) => call('POST', '/console/request', { type, data, requestId: 1 }, token);
  return { http, iam, call, rpc, requestRestart };
}

function cliIo(stdin = ''): ConsoleCliIo & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs, errors,
    log: message => { logs.push(message); },
    error: message => { errors.push(message); },
    readStdin: async () => stdin,
    prompt: async () => { throw new Error('unexpected prompt'); },
    hostRunning: async () => false,
  };
}

describe('zero-migration and bootstrap', () => {
  it('keeps a Host without http.token and without users open', async () => {
    const root = await project();
    const host = await startHost(root);
    expect((await host.call('GET', '/system/status')).status).toBe(200);
    expect((await host.call('GET', '/auth/me')).body.data).toMatchObject({ kind: 'bootstrap', open: true, setupRequired: true });
    expect((await host.rpc('iam.users.list', {})).status).toBe(200);
  });

  it('limits http.token to setup, creates the first owner, then rejects the token everywhere', async () => {
    const root = await project();
    const host = await startHost(root, { token: 'bootstrap-secret' });
    expect((await host.call('GET', '/auth/me')).body.data).toMatchObject({ kind: 'anonymous', setupRequired: true });
    expect((await host.call('GET', '/auth/me', undefined, 'bootstrap-secret')).body.data).toMatchObject({ kind: 'bootstrap', open: false, permissions: [] });
    expect((await host.call('GET', '/system/status', undefined, 'bootstrap-secret')).status).toBe(403);
    expect((await host.rpc('iam.users.list', {}, 'bootstrap-secret')).status).toBe(403);
    expect((await host.call('GET', '/auth/setup', undefined, 'bootstrap-secret')).body.data).toMatchObject({ setupRequired: true, database: { dialect: 'sqlite', source: 'default' } });
    expect((await host.call('POST', '/auth/setup', { username: 'alice', password: PASSWORD })).status).toBe(401);
    const setup = await host.call('POST', '/auth/setup', { username: 'alice', password: PASSWORD, displayName: 'Alice' }, 'bootstrap-secret');
    expect(setup.status).toBe(201);
    const session = setup.body.data.token as string;
    expect((await host.call('GET', '/system/status', undefined, 'bootstrap-secret')).status).toBe(401);
    expect((await host.call('POST', '/auth/setup', { username: 'bob', password: PASSWORD }, 'bootstrap-secret')).status).toBe(401);
    expect((await host.call('POST', '/auth/setup', { username: 'bob', password: PASSWORD }, session)).status).toBe(409);
    expect((await host.call('GET', '/auth/setup/database', undefined, session)).status).toBe(409);
    expect((await host.call('GET', '/auth/me', undefined, session)).body.data).toMatchObject({
      kind: 'user', user: { username: 'alice', displayName: 'Alice' }, setupRequired: false,
      bindings: [{ role: 'owner', scope: { kind: 'global' } }],
    });
    expect((await host.call('GET', '/system/status', undefined, session)).status).toBe(200);
    // Without http.token the setup Host also locks once an owner exists.
    expect((await host.call('GET', '/system/status')).status).toBe(401);
  });
});

describe('/auth and iam.* after setup', () => {
  async function initialised() {
    const root = await project();
    const host = await startHost(root, { token: 'bootstrap-secret' });
    const owner = (await host.call('POST', '/auth/setup', { username: 'alice', password: PASSWORD }, 'bootstrap-secret')).body.data.token as string;
    return { root, host, owner };
  }

  it('logs in, enforces permissions on RPC, audits denials and writes, and serves self-service tokens', async () => {
    const { host, owner } = await initialised();
    const created = await host.rpc('iam.users.create', { username: 'vera', password: PASSWORD, bindings: [{ role: 'viewer' }] }, owner);
    expect(created.status).toBe(200);
    expect((await host.call('POST', '/auth/login', { username: 'vera', password: 'wrong-password!' })).status).toBe(401);
    const login = await host.call('POST', '/auth/login', { username: 'vera', password: PASSWORD });
    expect(login.status).toBe(200);
    const vera = login.body.data.token as string;
    expect((await host.rpc('iam.users.list', {}, vera)).status).toBe(200);
    expect((await host.rpc('iam.users.create', { username: 'x', password: PASSWORD }, vera))).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    expect((await host.rpc('brand.new', {}, owner))).toMatchObject({ status: 403, body: { code: 'unmapped' } });
    const token = await host.call('POST', '/auth/tokens', { name: 'script' }, vera);
    expect(token.status).toBe(201);
    const apiToken = token.body.data.token as string;
    expect((await host.call('GET', '/auth/me', undefined, apiToken)).body.data).toMatchObject({ kind: 'api-token' });
    expect((await host.call('GET', '/auth/tokens', undefined, vera)).body.data.tokens).toHaveLength(1);
    expect(JSON.stringify((await host.call('GET', '/auth/tokens', undefined, vera)).body)).not.toContain(apiToken);
    await host.call('POST', '/auth/tokens/revoke', { id: token.body.data.record.id }, vera);
    expect((await host.call('GET', '/auth/me', undefined, apiToken)).body.data.kind).toBe('anonymous');
    const audit = await host.rpc('iam.audit.list', { limit: 100 }, owner);
    const actions = (audit.body.data.entries as Array<{ action: string; outcome: string }>);
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'rpc:iam.users.create', outcome: 'denied' }),
      expect.objectContaining({ action: 'rpc:iam.users.create', outcome: 'ok' }),
      expect.objectContaining({ action: 'rpc:brand.new', outcome: 'denied' }),
      expect.objectContaining({ action: 'auth.login', outcome: 'denied' }),
    ]));
    expect(JSON.stringify(audit.body)).not.toContain(PASSWORD);
    await host.call('POST', '/auth/logout', {}, vera);
    expect((await host.call('GET', '/system/status', undefined, vera)).status).toBe(401);
  });

  it('changes the password, revoking other sessions, and refuses to remove the last owner over RPC', async () => {
    const { host, owner } = await initialised();
    const other = (await host.call('POST', '/auth/login', { username: 'alice', password: PASSWORD })).body.data.token as string;
    const changed = await host.call('POST', '/auth/password', { currentPassword: PASSWORD, newPassword: 'another-password-1' }, owner);
    expect(changed.status).toBe(200);
    expect((await host.call('GET', '/system/status', undefined, other)).status).toBe(401);
    expect((await host.call('GET', '/system/status', undefined, owner)).status).toBe(401);
    const fresh = changed.body.data.token as string;
    const users = (await host.rpc('iam.users.list', {}, fresh)).body.data.users as Array<{ id: string }>;
    expect(await host.rpc('iam.users.disable', { id: users[0]!.id }, fresh)).toMatchObject({ status: 409, body: { code: 'last_owner' } });
    expect(await host.rpc('iam.bindings.set', { userId: users[0]!.id, bindings: [{ role: 'admin' }] }, fresh)).toMatchObject({ status: 409 });
  });

  it('rate-limits /auth/login with 429 and Retry-After', async () => {
    const { host } = await initialised();
    for (let attempt = 0; attempt < 5; attempt++) expect((await host.call('POST', '/auth/login', { username: 'alice', password: 'nope-nope-nope' })).status).toBe(401);
    const limited = await fetch(`${host.http.address!.origin}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'alice', password: PASSWORD }) });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('one setup flow for web and CLI (ADR 0049 §7)', () => {
  it('lists drivers from the scaffold-wizard definitions without redis or memory', async () => {
    const root = await project();
    const setup = new ConsoleSetupService({
      projectRoot: root,
      config: { readDocument: async () => ({}), setKey: async () => undefined },
      envFile: { read: async () => '', write: async () => undefined },
      iam: () => undefined,
      driverAvailable: async dialect => dialect === 'sqlite',
    });
    const drivers = await setup.drivers();
    expect(drivers.map(driver => driver.dialect)).toEqual(['sqlite', 'mysql', 'pg', 'mongodb']);
    expect(drivers.find(driver => driver.dialect === 'mysql')).toMatchObject({ available: false, missingPackage: 'mysql2' });
    expect(drivers.find(driver => driver.dialect === 'mysql')!.fields.find(field => field.name === 'password'))
      .toMatchObject({ secret: true, env: 'ZHIN_DATABASE_PASSWORD' });
    expect(drivers.find(driver => driver.dialect === 'sqlite')!.fields.find(field => field.name === 'filename')).toMatchObject({ default: '.zhin/data.sqlite' });
  });

  it('web: tests and saves a database (secrets to .env), then requests a restart', async () => {
    const root = await project();
    const host = await startHost(root, { token: 'bootstrap-secret' });
    const drivers = await host.call('GET', '/auth/setup/database', undefined, 'bootstrap-secret');
    expect(drivers.body.data).toMatchObject({ dialect: 'sqlite', source: 'default' });
    const tested = await host.call('POST', '/auth/setup/database/test', { dialect: 'sqlite', connection: { filename: 'data/other.sqlite' } }, 'bootstrap-secret');
    expect(tested.body.data).toMatchObject({ ok: true });
    const invalid = await host.call('POST', '/auth/setup/database/test', { dialect: 'redis', connection: {} }, 'bootstrap-secret');
    expect(invalid.status).toBe(400);
    const saved = await host.call('POST', '/auth/setup/database', { dialect: 'sqlite', connection: { filename: 'data/other.sqlite' } }, 'bootstrap-secret');
    expect(saved.body.data).toMatchObject({ restarting: true });
    await vi.waitFor(() => expect(host.requestRestart).toHaveBeenCalledOnce());
    expect(await readFile(join(root, 'zhin.config.yml'), 'utf8')).toMatch(/database:\s*\n\s+dialect: sqlite\s*\n\s+filename: data\/other\.sqlite/u);
  });

  it('writes secret fields as ${ZHIN_DATABASE_*} references and keeps other .env lines', async () => {
    const root = await project();
    await writeFile(join(root, '.env'), 'KEEP=1\nZHIN_DATABASE_PASSWORD=old\n');
    const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.yml')) });
    const probe = vi.fn(async () => ({ ok: true as const, latencyMs: 1 }));
    const setup = new ConsoleSetupService({
      projectRoot: root, config: store,
      envFile: { read: () => readFile(join(root, '.env'), 'utf8'), write: content => writeFile(join(root, '.env'), content) },
      iam: () => undefined, probe, environment: async () => ({}),
    });
    await setup.applyDatabase({ dialect: 'mysql', connection: { host: 'db.internal', port: '3307', user: 'bot', password: "p@ss w'rd", database: 'zhin' } });
    expect(probe).toHaveBeenCalledWith('mysql', expect.objectContaining({ host: 'db.internal', port: 3307, password: "p@ss w'rd" }));
    const config = await readFile(join(root, 'zhin.config.yml'), 'utf8');
    expect(config).toContain('${ZHIN_DATABASE_PASSWORD}');
    expect(config).not.toContain('p@ss');
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('KEEP=1\nZHIN_DATABASE_PASSWORD="p@ss w\'rd"\n');
    probe.mockResolvedValueOnce({ ok: false, error: 'refused' } as never);
    await expect(setup.applyDatabase({ dialect: 'pg', connection: { password: 'x' } })).rejects.toThrow(/refused/u);
    expect(upsertDotenv('', { A: 'plain' })).toBe("A='plain'\n");
  });

  it('CLI: initialises non-interactively on the same flow, then refuses a second init', async () => {
    const root = await project();
    const io = cliIo(`${PASSWORD}\n`);
    expect(await runConsoleInit(root, { database: 'sqlite', connection: { filename: '.zhin/accounts.sqlite' }, owner: 'alice', passwordStdin: true, yes: true }, io)).toBe(0);
    expect(io.errors).toEqual([]);
    expect(await readFile(join(root, 'zhin.config.yml'), 'utf8')).toContain('accounts.sqlite');
    // ADR 0053 §5: init records onboarding steps 1–2 on the same state file as the Console.
    expect(JSON.parse(await readFile(join(root, '.zhin/onboarding.json'), 'utf8')).steps).toEqual({ database: 'done', owner: 'done', ai: 'pending', adapters: 'pending' });
    const status = cliIo();
    expect(await runConsoleInit(root, { status: true }, status)).toBe(0);
    expect(JSON.parse(status.logs[0]!)).toMatchObject({ setupRequired: false, database: { dialect: 'sqlite', source: 'config' } });
    const again = cliIo(`${PASSWORD}\n`);
    expect(await runConsoleInit(root, { owner: 'bob', passwordStdin: true, yes: true }, again)).toBe(1);
    expect(again.errors[0]).toContain('zhin console user');
    // The Host started on the configured database sees the owner the CLI created.
    const host = await startHostOn(root, '.zhin/accounts.sqlite');
    expect((await host.call('POST', '/auth/login', { username: 'alice', password: PASSWORD })).status).toBe(200);
  });

  it('CLI user commands manage users offline and keep the last owner', async () => {
    const root = await project();
    expect(await runConsoleInit(root, { owner: 'alice', passwordStdin: true, yes: true }, cliIo(`${PASSWORD}\n`))).toBe(0);
    expect(JSON.parse(await readFile(join(root, '.zhin/onboarding.json'), 'utf8')).steps).toMatchObject({ owner: 'done' });
    expect(await consoleUserActions.create(root, 'vera', { role: 'viewer', passwordStdin: true }, cliIo(`${PASSWORD}\n`))).toBe(0);
    const list = cliIo();
    expect(await consoleUserActions.list(root, list)).toBe(0);
    expect(list.logs.join('\n')).toMatch(/alice.*owner[\s\S]*vera.*viewer/u);
    const lastOwner = cliIo();
    expect(await consoleUserActions.setDisabled(root, 'alice', true, lastOwner)).toBe(1);
    expect(lastOwner.errors[0]).toContain('最后一个所有者');
    expect(await consoleUserActions.passwd(root, 'alice', { passwordStdin: true }, cliIo('rescued-password-1\n'))).toBe(0);
    expect(await consoleUserActions.setDisabled(root, 'vera', true, cliIo())).toBe(0);
    expect(await consoleUserActions.passwd(root, 'ghost', { passwordStdin: true }, cliIo(`${PASSWORD}\n`))).toBe(1);
    const host = await startHostOn(root);
    expect((await host.call('POST', '/auth/login', { username: 'alice', password: PASSWORD })).status).toBe(401);
    expect((await host.call('POST', '/auth/login', { username: 'alice', password: 'rescued-password-1' })).status).toBe(200);
    expect((await host.call('POST', '/auth/login', { username: 'vera', password: PASSWORD })).status).toBe(401);
  });
});

async function startHostOn(root: string, filename = '.zhin/data.sqlite') {
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(root, filename) } as never);
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const configStore = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.yml')) });
  const iam = installConsoleIam(http, { database, configStore, projectRoot: root });
  await database.start();
  await iam.activate();
  const { origin } = await http.listen();
  closers.push(async () => { iam.dispose(); await http.close(); await database.stop(); });
  return {
    call: async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${origin}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    },
  };
}
