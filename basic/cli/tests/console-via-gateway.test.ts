/**
 * `zhin console init` / `zhin console user` beside a running gateway (ADR 0049 §7, ADR 0054 §6 /
 * §7): the CLI talks to the gateway's local socket and the gateway's own setup / IAM services
 * answer; without a gateway it opens the database itself.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalRpcHandler,
  gatewaySocketPath,
  LOCAL_GATEWAY_RPC,
  LocalControlServer,
  LocalGatewayClient,
  type LocalGatewayInfoResult,
} from '@zhin.js/gateway/local';
import { createGatewayConsoleRpc, GatewayHttpServer, startGatewayConsole, type GatewayConsole } from '@zhin.js/gateway/server';
import { createGatewayRpcDispatcher } from '@zhin.js/gateway/packages';
import { consoleUserActions, runConsoleInit, type ConsoleCliIo } from '../src/commands/console.js';

const PASSWORD = 'correct-horse-battery';
const dirs: string[] = [];
const closers: Array<() => Promise<unknown> | unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zcg-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: {} }));
  await writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  return root;
}

function cliIo(stdin = ''): ConsoleCliIo & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs, errors,
    log: (message) => { logs.push(message); },
    error: (message) => { errors.push(message); },
    readStdin: async () => stdin,
    prompt: async () => { throw new Error('unexpected prompt'); },
    hostRunning: async () => { throw new Error('the gateway path must not probe a Host'); },
  };
}

/** The gateway's Console module behind its local control socket, as `runGateway` wires them. */
async function runningGateway(root: string): Promise<{ console: GatewayConsole; restartInstance: ReturnType<typeof vi.fn>; requests: string[] }> {
  const server = new GatewayHttpServer({ http: { host: '127.0.0.1', port: 0 }, instance: { transport: () => undefined, state: () => 'running' } });
  closers.push(() => server.close());
  const restartInstance = vi.fn(async () => undefined);
  const gatewayConsole = await startGatewayConsole({ server, projectRoot: root, restartInstance, retryMs: 60_000 });
  closers.push(() => gatewayConsole.close());
  await gatewayConsole.ready;
  const requests: string[] = [];
  const control = await LocalControlServer.open({ path: gatewaySocketPath(root) });
  closers.push(() => control.close());
  const handler = createLocalRpcHandler({
    dispatch: createGatewayRpcDispatcher({}),
    console: gatewayConsole.localAdmin,
    info: () => ({
      gateway: { pid: process.pid, ports: [], origins: [], socket: control.path, startedAt: Date.now(), version: '0.0.0', mode: 'daemon', args: [] },
      instance: { state: 'running' },
      consoleInitialized: server.tokenRegistry.initialized(),
    }) as unknown as LocalGatewayInfoResult,
    shutdown: () => undefined,
  });
  control.setHandler(async (request, emit) => {
    requests.push(request.type);
    return handler(request, emit);
  });
  return { console: gatewayConsole, restartInstance, requests };
}

describe.runIf(process.platform !== 'win32')('zhin console beside a running gateway', () => {
  it('init switches the database in the gateway (reconnect + instance restart) and creates the owner there', async () => {
    const root = await project();
    const gateway = await runningGateway(root);
    expect(gateway.console.iam()?.initialized()).toBe(false);

    const io = cliIo(`${PASSWORD}\n`);
    expect(await runConsoleInit(root, {
      database: 'sqlite', connection: { filename: '.zhin/accounts.sqlite' }, owner: 'alice', passwordStdin: true, yes: true,
    }, io)).toBe(0);
    expect(io.errors).toEqual([]);
    expect(io.logs.join('\n')).toContain('网关已切换到新数据库');
    expect(gateway.requests).toEqual(expect.arrayContaining([
      LOCAL_GATEWAY_RPC.CONSOLE_SETUP_STATUS,
      LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE_TEST,
      LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE,
      LOCAL_GATEWAY_RPC.CONSOLE_SETUP_OWNER,
    ]));
    // The same ConsoleSetupService wrote the config; the gateway reconnected without a restart.
    expect(await readFile(path.join(root, 'zhin.config.yml'), 'utf8')).toContain('accounts.sqlite');
    expect(gateway.console.database()?.config).toMatchObject({ filename: path.join(root, '.zhin', 'accounts.sqlite') });
    expect(gateway.restartInstance).toHaveBeenCalledTimes(1);
    // Owner state changed at once in the gateway (no 30 s refresh): the bootstrap token is closed.
    expect(gateway.console.iam()?.initialized()).toBe(true);
    expect(gateway.console.setup.setupRequired()).toBe(false);
    expect(await gateway.console.iam()!.login('alice', PASSWORD)).toMatchObject({ user: { username: 'alice' } });

    const again = cliIo(`${PASSWORD}\n`);
    expect(await runConsoleInit(root, { owner: 'bob', passwordStdin: true, yes: true }, again)).toBe(1);
    expect(again.errors[0]).toContain('zhin console user');
  });

  it('user commands run through the gateway and keep the last owner', async () => {
    const root = await project();
    const gateway = await runningGateway(root);
    expect(await runConsoleInit(root, { owner: 'alice', passwordStdin: true, yes: true }, cliIo(`${PASSWORD}\n`))).toBe(0);
    expect(gateway.restartInstance).not.toHaveBeenCalled();
    expect(await consoleUserActions.create(root, 'vera', { role: 'viewer', passwordStdin: true }, cliIo(`${PASSWORD}\n`))).toBe(0);
    const list = cliIo();
    expect(await consoleUserActions.list(root, list)).toBe(0);
    expect(list.logs.join('\n')).toMatch(/alice.*owner[\s\S]*vera.*viewer/u);
    const lastOwner = cliIo();
    expect(await consoleUserActions.setDisabled(root, 'alice', true, lastOwner)).toBe(1);
    expect(lastOwner.errors[0]).toContain('最后一个所有者');
    // A session issued before the reset is revoked in the gateway's own service.
    const before = await gateway.console.iam()!.login('alice', PASSWORD);
    expect(await consoleUserActions.passwd(root, 'alice', { passwordStdin: true }, cliIo('rescued-password-1\n'))).toBe(0);
    expect(await gateway.console.iam()!.authenticate(before.token)).toBeNull();
    expect(await consoleUserActions.setDisabled(root, 'vera', true, cliIo())).toBe(0);
    const ghost = cliIo();
    expect(await consoleUserActions.passwd(root, 'ghost', { passwordStdin: true }, Object.assign(ghost, { readStdin: async () => `${PASSWORD}\n` }))).toBe(1);
    expect(ghost.errors[0]).toContain('ghost');
    expect(gateway.requests).toEqual(expect.arrayContaining([
      LOCAL_GATEWAY_RPC.CONSOLE_USER_CREATE,
      LOCAL_GATEWAY_RPC.CONSOLE_USER_LIST,
      LOCAL_GATEWAY_RPC.CONSOLE_USER_DISABLE,
      LOCAL_GATEWAY_RPC.CONSOLE_USER_PASSWD,
    ]));
    await expect(gateway.console.iam()!.login('alice', 'rescued-password-1')).resolves.toMatchObject({ user: { username: 'alice' } });
    await expect(gateway.console.iam()!.login('vera', PASSWORD)).rejects.toThrow();
    // Writes are audited with the local principal.
    const audit = await gateway.console.iam()!.listAudit({ actor: 'local' });
    expect(audit.entries.map((entry) => entry.action)).toEqual(expect.arrayContaining(['auth.setup', 'iam.users.create', 'iam.users.resetPassword', 'iam.users.disable']));
  });

  it('keeps gateway.console.* off HTTP, even for an owner', async () => {
    const root = await project();
    const server = new GatewayHttpServer({
      http: { host: '127.0.0.1', port: 0 },
      instance: { transport: () => undefined, state: () => 'running' },
      consoleRpc: createGatewayConsoleRpc(createGatewayRpcDispatcher({})),
    });
    closers.push(() => server.close());
    const gatewayConsole = await startGatewayConsole({ server, projectRoot: root, retryMs: 60_000 });
    closers.push(() => gatewayConsole.close());
    await gatewayConsole.ready;
    await gatewayConsole.setup.createOwner({ username: 'alice', password: PASSWORD });
    const { token } = await gatewayConsole.iam()!.login('alice', PASSWORD);
    for (const type of [LOCAL_GATEWAY_RPC.CONSOLE_USER_LIST, LOCAL_GATEWAY_RPC.CONSOLE_USER_CREATE, LOCAL_GATEWAY_RPC.CONSOLE_SETUP_DATABASE]) {
      const response = await server.handle(new Request('http://127.0.0.1/api/console/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, data: { username: 'mallory', password: PASSWORD, role: 'owner' }, requestId: 1 }),
      }));
      expect(response.status).toBe(403);
    }
    expect(await gatewayConsole.iam()!.findUser('mallory')).toBeNull();
  });

  it('falls back to the database when no gateway runs', async () => {
    const root = await project();
    await expect(LocalGatewayClient.connect({ root })).rejects.toMatchObject({ code: 'not_running' });
    const io = cliIo(`${PASSWORD}\n`);
    io.hostRunning = async () => false;
    expect(await runConsoleInit(root, { owner: 'alice', passwordStdin: true, yes: true }, io)).toBe(0);
    const list = cliIo();
    expect(await consoleUserActions.list(root, list)).toBe(0);
    expect(list.logs.join('\n')).toContain('alice');
  });
});
