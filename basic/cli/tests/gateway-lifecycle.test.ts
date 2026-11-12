// `zhin start / status / logs / restart / stop` against a real background gateway whose instance
// is a fake `zhin.js/instance` installed into a temporary project (ADR 0054 §6).
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cliPath = path.resolve(__dirname, '../lib/cli.js');
const hostHttp = path.resolve(__dirname, '../../../packages/host/http');

const FAKE_INSTANCE = `
import { createBridgedHttpHost, openInstanceControlChannel } from '@zhin.js/host-http/bridge';
export async function runStartCommand() {
  const channel = openInstanceControlChannel();
  if (!channel) throw new Error('expected a gateway control channel');
  const host = createBridgedHttpHost({ channel });
  host.route('GET', '/hello', () => Response.json({ hello: 'fake', pid: process.pid }));
  console.log('fake instance up ' + process.pid);
  let done;
  const completed = new Promise((resolve) => { done = resolve; });
  channel.onShutdown(() => {
    console.log('fake instance stopping');
    void host.close().then(() => { channel.close(); done(); });
  });
  await host.listen();
  channel.ready({ generation: 1, routes: host.routeTable() });
  await completed;
}
`;

interface Run { code: number; stdout: string; stderr: string }

function zhin(root: string, args: readonly string[], timeout = 60_000): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cliPath, ...args], {
      cwd: root,
      timeout,
      env: { ...process.env, NODE_OPTIONS: '', FORCE_COLOR: '0', NO_COLOR: '1' },
    }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

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

let root: string;
let port: number;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'zcli-'));
  port = await freePort();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fake-bot', private: true, type: 'module' }));
  await writeFile(path.join(root, 'zhin.config.yml'), `http:\n  host: 127.0.0.1\n  port: ${port}\n`);
  const fake = path.join(root, 'node_modules', 'zhin.js');
  await mkdir(fake, { recursive: true });
  await writeFile(path.join(fake, 'package.json'), JSON.stringify({ name: 'zhin.js', version: '0.0.0-fake', type: 'module', exports: { './instance': './instance.mjs' } }));
  await writeFile(path.join(fake, 'instance.mjs'), FAKE_INSTANCE);
  await mkdir(path.join(root, 'node_modules', '@zhin.js'), { recursive: true });
  await symlink(hostHttp, path.join(root, 'node_modules', '@zhin.js', 'host-http'), 'dir');
});

afterAll(async () => {
  await zhin(root, ['stop']);
  await rm(root, { recursive: true, force: true });
});

describe.runIf(process.platform !== 'win32')('zhin gateway lifecycle commands', () => {
  it('reports a stopped gateway and falls back when none runs', async () => {
    const status = await zhin(root, ['status', '--json']);
    expect(status.code).toBe(3);
    expect(JSON.parse(status.stdout)).toEqual({ gateway: { running: false }, instance: null });
    const stop = await zhin(root, ['stop']);
    expect(stop.code).toBe(0);
    expect(stop.stdout).toContain('网关未运行');
    const restart = await zhin(root, ['restart']);
    expect(restart.code).toBe(0);
    expect(restart.stdout).toContain('网关未运行');
    const logs = await zhin(root, ['logs']);
    expect(logs.code).toBe(1);
    expect(logs.stderr).toContain('网关未运行');
  }, 60_000);

  it('starts in the background, reports status and logs, restarts the instance and stops', async () => {
    const started = await zhin(root, ['start', '--mode', 'production', '--no-watch']);
    expect(started.stderr).toBe('');
    expect(started.code).toBe(0);
    expect(started.stdout).toContain('网关已在后台启动');
    expect(started.stdout).toContain(`http://127.0.0.1:${port}`);
    expect(started.stdout).toContain(`https://console.zhin.dev/?apiBaseUrl=${encodeURIComponent(`http://127.0.0.1:${port}`)}`);

    const hello = await fetch(`http://127.0.0.1:${port}/hello`);
    expect(await hello.json()).toMatchObject({ hello: 'fake' });

    const again = await zhin(root, ['start']);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('网关已在运行');

    const status = await zhin(root, ['status', '--json']);
    expect(status.code).toBe(0);
    const parsed = JSON.parse(status.stdout) as { gateway: { running: boolean; mode: string; pid: number; args: string[]; ports: number[] }; instance: { state: string; pid: number } };
    expect(parsed.gateway).toMatchObject({ running: true, mode: 'daemon', ports: [port], args: ['--mode', 'production', '--no-watch'] });
    expect(parsed.instance.state).toBe('running');
    const human = await zhin(root, ['status']);
    expect(human.stdout).toContain('网关：运行中');
    expect(human.stdout).toContain('实例：running');

    const logs = await zhin(root, ['logs', '-n', '20']);
    expect(logs.code).toBe(0);
    expect(logs.stdout).toContain(`fake instance up ${parsed.instance.pid}`);

    const restarted = await zhin(root, ['restart']);
    expect(restarted.code).toBe(0);
    expect(restarted.stdout).toContain('实例已重启');
    const after = JSON.parse((await zhin(root, ['status', '--json'])).stdout) as typeof parsed;
    expect(after.gateway.pid).toBe(parsed.gateway.pid);
    expect(after.instance.pid).not.toBe(parsed.instance.pid);

    const stopped = await zhin(root, ['stop']);
    expect(stopped.code).toBe(0);
    expect(stopped.stdout).toContain('网关与实例已停止');
    expect((await zhin(root, ['status'])).code).toBe(3);
    await expect(fetch(`http://127.0.0.1:${port}/hello`)).rejects.toThrow();

    // Offline, `zhin logs` reads the instance log file the gateway wrote.
    const offline = await zhin(root, ['logs', '-n', '50']);
    expect(offline.code).toBe(0);
    expect(offline.stdout).toContain('fake instance stopping');
  }, 120_000);

  it('restarts a background gateway with its original options', async () => {
    expect((await zhin(root, ['start', '--mode', 'production', '--no-watch'])).code).toBe(0);
    const before = JSON.parse((await zhin(root, ['status', '--json'])).stdout) as { gateway: { pid: number } };
    const restarted = await zhin(root, ['restart', '--gateway']);
    expect(restarted.code).toBe(0);
    expect(restarted.stdout).toContain('网关已重启');
    const after = JSON.parse((await zhin(root, ['status', '--json'])).stdout) as { gateway: { pid: number; args: string[] }; instance: { state: string } };
    expect(after.gateway.pid).not.toBe(before.gateway.pid);
    expect(after.gateway.args).toEqual(['--mode', 'production', '--no-watch']);
    expect(after.instance.state).toBe('running');
    expect((await zhin(root, ['stop'])).code).toBe(0);
  }, 120_000);
});
