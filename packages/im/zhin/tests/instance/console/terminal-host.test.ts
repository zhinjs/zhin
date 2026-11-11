import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { createHttpHost, type ProcessHttpHost } from '@zhin.js/host-http/node';
import { installConsoleIam } from '../../../../../host/gateway/src/iam/install.js';
import { installHostConsoleTerminal } from '../../../../../host/gateway/src/terminal/host.js';
import type { PtyModule } from '../../../../../host/gateway/src/terminal/modules.js';

// The start-path wiring: real HTTP Host, real IAM (sqlite) and the terminal on top; node-pty is faked.
const PASSWORD = 'correct-horse-battery';
const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const fakePty: PtyModule = {
  spawn: () => {
    let onExit: ((event: { exitCode: number }) => void) | undefined;
    return {
      pid: 1,
      onData: () => undefined,
      onExit: (listener) => { onExit = listener; },
      write: () => undefined,
      resize: () => undefined,
      kill: () => { onExit?.({ exitCode: 0 }); },
    };
  },
};

async function startHost(terminal: unknown, options: { token?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-terminal-host-'));
  roots.push(root);
  const database = createDatabaseHost({ dialect: 'sqlite', filename: join(root, '.zhin', 'data.sqlite') } as never);
  const http: ProcessHttpHost = createHttpHost({ host: '127.0.0.1', port: 0, ...(options.token ? { token: options.token } : {}) });
  const configStore = { readDocument: async () => ({}), setKey: async () => undefined };
  const iam = installConsoleIam(http, { database: database.gatewayTableHost(), configStore, projectRoot: root });
  const handle = installHostConsoleTerminal(http, {
    config: terminal,
    projectRoot: root,
    iam: () => iam.service,
    modules: { loadPty: async () => fakePty },
  });
  await database.start();
  await iam.activate();
  const { origin } = await http.listen();
  closers.push(async () => { handle.close(); iam.dispose(); await http.close(); await database.stop(); });
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) as Record<string, any> | null };
  };
  return { origin, iam, handle, call };
}

async function seedUsers(iam: Awaited<ReturnType<typeof startHost>>['iam']) {
  const owner = await iam.service.createOwner({ username: 'alice', password: PASSWORD });
  await iam.service.createUser({ username: 'victor', password: PASSWORD, bindings: [{ role: 'viewer' }] });
  const ownerToken = (await iam.service.login('alice', PASSWORD)).token;
  const viewerToken = (await iam.service.login('victor', PASSWORD)).token;
  return { owner, ownerToken, viewerToken };
}

function openTerminal(origin: string, ticket: string) {
  const ws = new WebSocket(`${origin.replace('http', 'ws')}/api/console/terminal?ticket=${encodeURIComponent(ticket)}`);
  const texts: string[] = [];
  ws.on('message', (data, isBinary) => { if (!isBinary) texts.push(data.toString()); });
  const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)));
  return { ws, texts, closed };
}

describe('Console terminal wired to Console access control', () => {
  it('issues tickets to an owner, refuses a viewer and the bootstrap token', async () => {
    const { iam, call } = await startHost({ enabled: true, shell: '/bin/sh' }, { token: 'bootstrap-secret' });
    // Before setup the bootstrap token is not a person: no terminal.
    expect((await call('GET', '/console/terminal/targets', 'bootstrap-secret')).status).toBe(403);
    const { ownerToken, viewerToken } = await seedUsers(iam);

    const targets = await call('GET', '/console/terminal/targets', ownerToken);
    expect(targets.status).toBe(200);
    expect(targets.body?.data).toEqual([expect.objectContaining({ id: 'local', available: true })]);
    const ticket = await call('POST', '/console/terminal/tickets', ownerToken, { target: 'local' });
    expect(ticket.status).toBe(200);
    expect(ticket.body?.data.ticket).toEqual(expect.any(String));

    expect((await call('GET', '/console/terminal/targets', viewerToken)).status).toBe(403);
    expect((await call('POST', '/console/terminal/tickets', viewerToken, { target: 'local' })).status).toBe(403);
    expect((await call('GET', '/console/terminal/targets')).status).toBe(401);
    // API tokens are narrowed to their own permission list.
    const narrow = await iam.service.createToken((await iam.service.findUser('alice'))!.id, { name: 'ci', permissions: ['status.view'] });
    expect((await call('GET', '/console/terminal/targets', narrow.token)).status).toBe(403);
    const wide = await iam.service.createToken((await iam.service.findUser('alice'))!.id, { name: 'ops', permissions: ['ops.terminal'] });
    expect((await call('GET', '/console/terminal/targets', wide.token)).status).toBe(200);

    await vi.waitFor(async () => {
      const { entries } = await iam.service.listAudit({ action: 'terminal.ticket.issue' });
      expect(entries).toEqual([expect.objectContaining({ outcome: 'ok', target: 'terminal:local' })]);
    });
  });

  it('returns 404 when the terminal is not enabled', async () => {
    const { iam, call, handle } = await startHost({ enabled: false });
    const { ownerToken } = await seedUsers(iam);
    expect(handle.enabled).toBe(false);
    expect((await call('GET', '/console/terminal/targets', ownerToken)).status).toBe(404);
    expect((await call('POST', '/console/terminal/tickets', ownerToken, { target: 'local' })).status).toBe(404);
  });

  it('ends a running session when the user is disabled', async () => {
    const { origin, iam, call, handle } = await startHost({ enabled: true, shell: '/bin/sh' });
    const { ownerToken } = await seedUsers(iam);
    // A second owner so the first one may be disabled.
    await iam.service.createUser({ username: 'bob', password: PASSWORD, bindings: [{ role: 'owner' }] });
    const ticket = (await call('POST', '/console/terminal/tickets', ownerToken, { target: 'local' })).body?.data.ticket as string;
    const session = openTerminal(origin, ticket);
    await vi.waitFor(() => expect(session.texts.some(text => text.includes('"ready"'))).toBe(true));
    expect(handle.sessions()).toHaveLength(1);

    await iam.service.setDisabled((await iam.service.findUser('alice'))!.id, true);
    await vi.waitFor(() => expect(session.texts.some(text => text.includes('"revoked"'))).toBe(true));
    await session.closed;
    expect(handle.sessions()).toHaveLength(0);
  });

  it('ends sessions and pending tickets on a password change', async () => {
    const { origin, iam, call, handle } = await startHost({ enabled: true, shell: '/bin/sh' });
    const { ownerToken } = await seedUsers(iam);
    const ticket = (await call('POST', '/console/terminal/tickets', ownerToken, { target: 'local' })).body?.data.ticket as string;
    const principal = (await iam.service.authenticate(ownerToken))!;
    await iam.service.changePassword(principal, PASSWORD, 'another-long-password');
    const session = openTerminal(origin, ticket);
    await vi.waitFor(() => expect(session.texts.some(text => text.includes('invalid-ticket'))).toBe(true));
    expect(await session.closed).toBe(4401);
    expect(handle.sessions()).toHaveLength(0);
  });
});
