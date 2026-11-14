import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { projectIdentity } from '../../src/project/identity.js';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { GatewayInstanceLogs, GatewayInstanceStatus } from '@zhin.js/console-protocol';
import { parseStartOptions } from '@zhin.js/runtime';
import { runGateway, type RunningGatewayProcess } from '../../src/http/run-gateway.js';
import { LocalGatewayClient } from '../../src/local/client.js';
import { LocalControlServer } from '../../src/local/local-socket.js';
import { gatewayInfoFile } from '../../src/local/paths.js';
import { LOCAL_GATEWAY_RPC, type LocalGatewayInfoResult } from '../../src/local/protocol.js';

const fixture = fileURLToPath(new URL('./fixtures/lifecycle-instance.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../../../../node_modules/tsx/dist/esm/index.mjs', import.meta.url));
const dirs: string[] = [];
const savedNodeOptions = process.env.NODE_OPTIONS;

afterEach(async () => {
  if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = savedNodeOptions;
  delete process.env.FAKE_CRASH;
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
    } catch { /* not yet */ }
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function start(crash = false): Promise<{ root: string; origin: string; exit: Promise<number>; ready: Promise<RunningGatewayProcess> }> {
  const root = await mkdtemp(join(tmpdir(), 'zgw-run-'));
  dirs.push(root);
  const port = await freePort();
  await writeFile(join(root, 'zhin.config.yml'), `http:\n  host: 127.0.0.1\n  port: ${port}\n`);
  process.env.NODE_OPTIONS = `--conditions=development --import=${tsx}`;
  if (crash) process.env.FAKE_CRASH = '1';
  let onReady!: (value: RunningGatewayProcess) => void;
  const ready = new Promise<RunningGatewayProcess>((resolve) => { onReady = resolve; });
  const args = ['runtime', 'start'];
  const exit = runGateway({
    root, options: parseStartOptions([]), entry: fixture, args, echo: false, signals: false,
    restart: { maxRestarts: 2, delayMs: 20 },
    onReady,
  });
  exit.catch(() => undefined);
  return { root, origin: `http://127.0.0.1:${port}`, exit, ready };
}

async function client(root: string): Promise<LocalGatewayClient> {
  return LocalGatewayClient.connect({ root });
}

describe.runIf(process.platform !== 'win32')('runGateway (long-lived gateway)', () => {
  it('keeps running when the instance is stopped or crashes, and stops on gateway.shutdown', async () => {
    const { root, origin, exit, ready } = await start();
    const running = await ready;
    await until(async () => ((await fetch(`${origin}/hello`)).status === 200 ? true : undefined));

    // gateway.json and the socket are owner-only.
    const info = JSON.parse(await readFile(gatewayInfoFile(root), 'utf8')) as Record<string, unknown>;
    expect(info).toMatchObject({ pid: process.pid, socket: join(root, '.zhin', 'gateway.sock'), mode: 'foreground', args: [] });
    expect(info.ports).toEqual([Number(new URL(origin).port)]);
    expect((await stat(gatewayInfoFile(root))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, '.zhin', 'gateway.sock'))).mode & 0o777).toBe(0o600);
    // A second gateway on the same project is refused before it binds anything.
    await expect(LocalControlServer.open({ path: running.info.socket })).rejects.toMatchObject({ code: 'in_use' });

    const local = await client(root);
    const status = await local.info();
    expect(status).toMatchObject({ gateway: { pid: process.pid, version: expect.any(String) }, instance: { state: 'running' } });

    // Stopping the instance over the socket does not end the gateway.
    expect(await local.request<GatewayInstanceStatus>('gateway.instance.stop')).toMatchObject({ state: 'stopped' });
    const stoppedHealth = await fetch(`${origin}/pub/health`);
    expect(stoppedHealth.status).toBe(200);
    // The project id lets the CLI tell this project's gateway from another one on the port (#1250).
    expect(await stoppedHealth.json()).toMatchObject({ project: { id: projectIdentity(root) } });
    expect(await local.request<GatewayInstanceStatus>('gateway.instance.start')).toMatchObject({ state: 'running' });
    expect(await local.request<GatewayInstanceStatus>('gateway.instance.restart')).toMatchObject({ state: 'running' });

    // A crash is restarted; the gateway stays up meanwhile.
    expect((await fetch(`${origin}/crash`, { method: 'POST' })).status).toBe(202);
    await until(async () => ((await local.info()).instance.recentRestarts >= 1 && (await local.info()).instance.state === 'running' ? true : undefined));

    const logs = await local.request<GatewayInstanceLogs>('gateway.instance.logs', { lines: 50 });
    expect(logs.lines.some((line) => line.line.startsWith('fake instance up'))).toBe(true);
    expect(await readFile(join(root, '.zhin', 'logs', 'instance.log'), 'utf8')).toContain('fake instance up');

    await expect(local.request(LOCAL_GATEWAY_RPC.SHUTDOWN)).resolves.toEqual({ stopping: true });
    local.close();
    expect(await exit).toBe(0);
    await expect(fetch(`${origin}/pub/health`)).rejects.toThrow();
    await expect(stat(join(root, '.zhin', 'gateway.sock'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(gatewayInfoFile(root))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('stays up with the instance crashed after a restart storm', async () => {
    const { root, origin, exit, ready } = await start(true);
    await ready;
    const local = await client(root);
    const crashed = await until(async () => {
      const status: LocalGatewayInfoResult = await local.info();
      return status.instance.state === 'crashed' ? status : undefined;
    });
    expect(crashed.instance.lastFailure).toMatchObject({ reason: 'restart-storm' });
    expect(crashed.instance.lastFailure?.logTail).toContain('fake instance crashing');
    // The Console stays reachable and reports the state.
    const health = await (await fetch(`${origin}/pub/health`)).json() as { instance: { state: string } };
    expect(health.instance.state).toBe('crashed');
    // No further automatic restarts: it waits for someone to act.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await local.info()).instance.state).toBe('crashed');
    await local.request(LOCAL_GATEWAY_RPC.SHUTDOWN);
    local.close();
    expect(await exit).toBe(0);
  }, 60_000);
});
