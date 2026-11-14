import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTANCE_BRIDGE_PROTOCOL_VERSION, INSTANCE_CHILD_ENV } from '@zhin.js/host-http/bridge';
import {
  InstanceProtocolMismatchError,
  InstanceStartError,
  InstanceSupervisor,
  type InstanceState,
  type InstanceSupervisorOptions,
} from '../../src/supervisor/instance-supervisor.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-instance.mjs', import.meta.url));
const supervisors: InstanceSupervisor[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) {
    await supervisor.stop({ force: true }).catch(() => undefined);
    supervisor.dispose();
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zhin-supervisor-'));
  dirs.push(dir);
  return dir;
}

function supervise(
  env: Record<string, string> = {},
  options: Partial<Omit<InstanceSupervisorOptions, 'spawn'>> = {},
): InstanceSupervisor {
  const supervisor = new InstanceSupervisor({
    spawn: { command: process.execPath, args: [fixture], cwd: process.cwd(), env: { ...process.env, ...env } },
    readyTimeoutMs: 5_000,
    shutdownBudgetMs: 300,
    killGraceMs: 300,
    ...options,
    restart: { delayMs: 50, ...options.restart },
  });
  supervisors.push(supervisor);
  return supervisor;
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 8_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const value = check();
      if (value !== undefined && value !== false) { resolve(value); return; }
      if (Date.now() - started > timeoutMs) { reject(new Error('timed out')); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function recordStates(supervisor: InstanceSupervisor): InstanceState[] {
  const states: InstanceState[] = [];
  supervisor.on('state', (status) => { states.push(status.state); });
  return states;
}

async function lines(file: string): Promise<string[]> {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean);
}

describe('InstanceSupervisor', () => {
  it('starts the instance over an advanced-serialization IPC channel and completes the ready handshake', async () => {
    const supervisor = supervise({ FAKE_CHILD_MARKER: INSTANCE_CHILD_ENV });
    const states = recordStates(supervisor);
    const ready = new Promise((resolve) => { supervisor.once('ready', resolve); });
    await supervisor.start();
    expect(await ready).toMatchObject({ version: INSTANCE_BRIDGE_PROTOCOL_VERSION, generation: 1 });
    const status = supervisor.status();
    expect(status).toMatchObject({ state: 'running', generation: 1, protocolVersion: INSTANCE_BRIDGE_PROTOCOL_VERSION });
    expect(status.pid).toBeTypeOf('number');
    expect(status.startedAt).toBeTypeOf('number');
    expect(states).toEqual(['starting', 'running']);
    // The child is marked as a supervised instance.
    await waitFor(() => supervisor.logs.tail().some((line) => line.line === `marker=${INSTANCE_BRIDGE_PROTOCOL_VERSION}`) || undefined);
  });

  it('reports the generation of the latest route table after hot reloads, not the one in ready (#1250)', async () => {
    // Out-of-order 4 after 6 must not roll the reported generation back.
    const supervisor = supervise({ FAKE_ROUTE_GENERATIONS: '2,6,4' });
    await supervisor.start();
    await waitFor(() => supervisor.status().generation === 6 || undefined);
    expect(supervisor.status()).toMatchObject({ state: 'running', generation: 6 });
    // A restarted instance starts over from its own ready generation.
    const restarted = supervise();
    await restarted.start();
    expect(restarted.status().generation).toBe(1);
  });

  it('rejects an instance that reports an incompatible protocol version and does not restart it', async () => {
    const supervisor = supervise({ FAKE_VERSION: String(INSTANCE_BRIDGE_PROTOCOL_VERSION + 1) });
    await expect(supervisor.start()).rejects.toBeInstanceOf(InstanceProtocolMismatchError);
    await waitFor(() => supervisor.state === 'crashed' || undefined);
    expect(supervisor.status().lastFailure).toMatchObject({ reason: 'protocol-mismatch' });
    // The mismatching instance is told to shut down.
    expect(supervisor.logs.tail().map((line) => line.line)).toContain('shutdown protocol-mismatch 300');
  });

  it('fails the start when ready does not arrive in time', async () => {
    const supervisor = supervise({ FAKE_NO_READY: '1' }, { readyTimeoutMs: 200, restart: { onCrash: false } });
    const error = await supervisor.start().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(InstanceStartError);
    expect((error as InstanceStartError).failure.reason).toBe('ready-timeout');
    await waitFor(() => supervisor.state === 'crashed' || undefined);
  });

  it('stops gracefully with a shutdown message carrying reason and budget', async () => {
    const supervisor = supervise();
    await supervisor.start();
    const exit = new Promise((resolve) => { supervisor.once('exit', resolve); });
    await supervisor.stop({ reason: 'operator' });
    expect(await exit).toEqual({ code: 0, signal: null, expected: true });
    expect(supervisor.state).toBe('stopped');
    expect(supervisor.logs.tail().map((line) => line.line)).toContain('shutdown operator 300');
  });

  it('escalates to SIGTERM and then SIGKILL when the instance ignores shutdown', async () => {
    const supervisor = supervise({ FAKE_IGNORE_SHUTDOWN: '1', FAKE_IGNORE_SIGTERM: '1' });
    await supervisor.start();
    const exit = new Promise((resolve) => { supervisor.once('exit', resolve); });
    const started = Date.now();
    await supervisor.stop({ timeoutMs: 200 });
    expect(await exit).toMatchObject({ signal: 'SIGKILL', expected: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(supervisor.state).toBe('stopped');
    expect(supervisor.logs.tail().map((line) => line.line)).toContain('sigterm-ignored');
  });

  it('stops with SIGTERM when the instance ignores shutdown but honours the signal', async () => {
    const supervisor = supervise({ FAKE_IGNORE_SHUTDOWN: '1' });
    await supervisor.start();
    const exit = new Promise((resolve) => { supervisor.once('exit', resolve); });
    await supervisor.stop({ timeoutMs: 100 });
    expect(await exit).toMatchObject({ signal: 'SIGTERM', expected: true });
  });

  it('restarts the instance on restart-request without passing through stopped', async () => {
    const counter = join(await tempDir(), 'starts');
    const supervisor = supervise({ FAKE_COUNTER_FILE: counter, FAKE_RESTART_AFTER_MS: '50' });
    const states = recordStates(supervisor);
    const requests: unknown[] = [];
    supervisor.on('restart-request', (payload) => { requests.push(payload); });
    await supervisor.start();
    await waitFor(() => (states.filter((state) => state === 'running').length === 2 ? true : undefined));
    expect(requests).toEqual([{ reason: 'test' }]);
    expect(states).toEqual(['starting', 'running', 'stopping', 'starting', 'running']);
    expect(await lines(counter)).toHaveLength(2);
    expect(supervisor.logs.tail().map((line) => line.line)).toContain('shutdown restart:test 300');
  });

  it('a manual stop during a requested restart cancels the respawn', async () => {
    const counter = join(await tempDir(), 'starts');
    const supervisor = supervise({ FAKE_COUNTER_FILE: counter, FAKE_RESTART_AFTER_MS: '0', FAKE_IGNORE_SHUTDOWN: '1' });
    await supervisor.start();
    await waitFor(() => supervisor.state === 'stopping' || undefined);
    await supervisor.stop({ timeoutMs: 50 });
    expect(supervisor.state).toBe('stopped');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(supervisor.state).toBe('stopped');
    expect(await lines(counter)).toHaveLength(1);
  });

  it('ignores restart-request when the policy disables it', async () => {
    const supervisor = supervise({ FAKE_RESTART_AFTER_MS: '0' }, { restart: { onRequest: false } });
    const request = new Promise((resolve) => { supervisor.once('restart-request', resolve); });
    await supervisor.start();
    await request;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(supervisor.state).toBe('running');
  });

  it('restarts a crashed instance after the backoff delay', async () => {
    const counter = join(await tempDir(), 'starts');
    const supervisor = supervise({ FAKE_COUNTER_FILE: counter, FAKE_CRASH_AFTER_MS: '50', FAKE_CRASH_CODE: '3' }, {
      restart: { maxRestarts: 1, windowMs: 60_000 },
    });
    const states = recordStates(supervisor);
    await supervisor.start();
    await waitFor(() => supervisor.state === 'crashed' || undefined);
    // first crash → backoff → second run; second crash exceeds the budget of 1 → crashed
    expect(states).toEqual(['starting', 'running', 'backoff', 'starting', 'running', 'crashed']);
    expect(await lines(counter)).toHaveLength(2);
    const status = supervisor.status();
    expect(status).toMatchObject({ lastExitCode: 3, recentRestarts: 1 });
    expect(status.lastFailure?.reason).toBe('restart-storm');
    expect(status.lastFailure?.logTail).toContain('crashing');
  });

  it('storm protection: N crashes inside the window leave the instance crashed', async () => {
    const counter = join(await tempDir(), 'starts');
    const supervisor = supervise({ FAKE_COUNTER_FILE: counter, FAKE_NO_READY: '1', FAKE_CRASH_AFTER_MS: '0' }, {
      restart: { maxRestarts: 3, windowMs: 60_000, delayMs: 10 },
    });
    await expect(supervisor.start()).rejects.toBeInstanceOf(InstanceStartError);
    await waitFor(() => supervisor.state === 'crashed' || undefined);
    expect(await lines(counter)).toHaveLength(4);
    // A manual start resets the storm window.
    await expect(supervisor.start()).rejects.toBeInstanceOf(InstanceStartError);
    await waitFor(() => supervisor.state === 'crashed' || undefined);
    expect(await lines(counter)).toHaveLength(8);
  });

  it('does not restart crashes when crash restart is disabled', async () => {
    const supervisor = supervise({ FAKE_CRASH_AFTER_MS: '20' }, { restart: { onCrash: false } });
    await supervisor.start();
    await waitFor(() => supervisor.state === 'crashed' || undefined);
    expect(supervisor.status().lastFailure?.reason).toBe('exit');
  });

  it('treats a clean exit of its own (e.g. --once) as stopped', async () => {
    const supervisor = supervise({ FAKE_EXIT_AFTER_READY: '1' });
    await supervisor.start();
    await waitFor(() => supervisor.state === 'stopped' || undefined);
    expect(supervisor.status()).toMatchObject({ lastExitCode: 0 });
    expect(supervisor.status().lastFailure).toBeUndefined();
  });

  it('stop() during backoff cancels the pending restart', async () => {
    const supervisor = supervise({ FAKE_CRASH_AFTER_MS: '20' }, { restart: { delayMs: 500 } });
    await supervisor.start();
    await waitFor(() => supervisor.state === 'backoff' || undefined);
    await supervisor.stop();
    expect(supervisor.state).toBe('stopped');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(supervisor.state).toBe('stopped');
  });

  it('manual restart() stops and starts again', async () => {
    const counter = join(await tempDir(), 'starts');
    const supervisor = supervise({ FAKE_COUNTER_FILE: counter });
    await supervisor.start();
    await supervisor.restart();
    expect(supervisor.state).toBe('running');
    expect(await lines(counter)).toHaveLength(2);
  });

  it('captures stdout / stderr into the ring buffer and a rotating log file, with live subscription', async () => {
    const file = join(await tempDir(), 'logs', 'instance.log');
    const supervisor = supervise({ FAKE_LOG_LINES: '40', FAKE_PARTIAL: 'no newline' }, {
      logs: { file, capacity: 10, maxBytes: 200, maxFiles: 2 },
    });
    const live: string[] = [];
    supervisor.on('log', (line) => { live.push(`${line.stream}:${line.line}`); });
    await supervisor.start();
    await waitFor(() => live.includes('stdout:out 39') && live.includes('stderr:err 39') ? true : undefined);
    await supervisor.stop();
    // The unterminated trailing output is flushed when the child exits.
    expect(live).toContain('stdout:no newline');
    expect(supervisor.logs.tail()).toHaveLength(10);
    expect(supervisor.logs.tail(3).map((line) => line.line)).toHaveLength(3);
    expect((await stat(file)).size).toBeLessThanOrEqual(200);
    expect((await stat(`${file}.1`)).size).toBeLessThanOrEqual(200);
    expect((await stat(`${file}.2`)).size).toBeLessThanOrEqual(200);
    await expect(stat(`${file}.3`)).rejects.toThrow();
  });

  it('output: inherit spawns without capture', async () => {
    const supervisor = supervise({}, { output: 'inherit' });
    await supervisor.start();
    expect(supervisor.logs.tail()).toEqual([]);
  });

  it('a spawn failure is reported as spawn-error', async () => {
    const supervisor = new InstanceSupervisor({
      spawn: { command: join(tmpdir(), 'zhin-missing-binary'), args: [], cwd: process.cwd() },
      restart: { onCrash: false },
    });
    supervisors.push(supervisor);
    const error = await supervisor.start().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(InstanceStartError);
    expect((error as InstanceStartError).failure.reason).toBe('spawn-error');
    expect(supervisor.state).toBe('crashed');
  });
});

describe('InstanceSupervisor HTTP bridge', () => {
  const bridged = fileURLToPath(new URL('./fixtures/bridged-instance.ts', import.meta.url));
  const tsx = fileURLToPath(new URL('../../../../../node_modules/tsx/dist/esm/index.mjs', import.meta.url));

  function superviseBridged(): InstanceSupervisor {
    const supervisor = new InstanceSupervisor({
      spawn: { command: process.execPath, args: ['--conditions', 'development', '--import', tsx, bridged], cwd: process.cwd() },
      readyTimeoutMs: 15_000,
      shutdownBudgetMs: 2_000,
      killGraceMs: 500,
      restart: { delayMs: 50 },
    });
    supervisors.push(supervisor);
    return supervisor;
  }

  it('forwards HTTP and WebSocket traffic to the current child and follows restarts', async () => {
    const supervisor = superviseBridged();
    expect(supervisor.transport.ready).toBe(false);
    await supervisor.start();
    await waitFor(() => supervisor.transport.ready || undefined);
    expect(supervisor.transport.routes().http.map((route) => route.pattern)).toEqual(expect.arrayContaining(['/hello', '/upload']));
    expect(supervisor.transport.routes().ws).toEqual([{ path: '/echo', auth: 'protocol' }]);
    const pid = supervisor.status().pid;
    const hello = await supervisor.transport.fetch(new Request('http://gateway/hello'));
    expect(await hello.text()).toBe(`hello v1 from ${pid}`);
    // A body larger than one window travels in chunks with credit (structured clone over real IPC).
    const upload = await supervisor.transport.fetch(new Request('http://gateway/upload', { method: 'POST', body: new Uint8Array(1_500_000) }));
    expect(await upload.text()).toBe('1500000');
    // Route table follows registrations in the instance.
    const tables: string[][] = [];
    supervisor.transport.onRoutes((table) => tables.push(table.http.map((route) => route.pattern)));
    await supervisor.transport.fetch(new Request('http://gateway/reload', { method: 'POST' }));
    await waitFor(() => tables.some((patterns) => patterns.includes('/v2')) || undefined);
    // WebSocket frames.
    const received: (string | Uint8Array)[] = [];
    const listeners = new Set<(data: string | Uint8Array) => void>();
    const peer = {
      url: new URL('http://gateway/echo'), headers: new Headers(), bufferedAmount: 0,
      send: (data: string | Uint8Array) => { received.push(data); },
      close: () => undefined,
      onMessage: (listener: (data: string | Uint8Array) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      onClose: () => () => undefined,
    };
    expect(await supervisor.transport.openWebSocket({ url: peer.url, headers: peer.headers }, peer)).toBe(true);
    for (const listener of listeners) listener(new Uint8Array([9, 8, 7]));
    await waitFor(() => received.length > 0 || undefined);
    expect(received[0]).toEqual(new Uint8Array([9, 8, 7]));

    // Restart: the transport follows the new child.
    await supervisor.restart();
    await waitFor(() => supervisor.transport.ready || undefined);
    const next = supervisor.status().pid;
    expect(next).not.toBe(pid);
    expect(await (await supervisor.transport.fetch(new Request('http://gateway/hello'))).text()).toBe(`hello v1 from ${next}`);
    await supervisor.stop();
    expect(supervisor.transport.ready).toBe(false);
    await expect(supervisor.transport.fetch(new Request('http://gateway/hello'))).rejects.toMatchObject({ code: 'instance-offline' });
  }, 60_000);
});

describe('InstanceSupervisor stdin', () => {
  const wrapper = fileURLToPath(new URL('./fixtures/stdin-supervisor.mts', import.meta.url));
  const run = (input: 'inherit' | 'ignore'): Promise<string> => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=development', wrapper, input], { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += String(chunk); });
    child.once('error', reject);
    child.once('exit', () => resolve(output));
    // Kept open: with `ignore` the instance must see end-of-input anyway.
    child.stdin.write('hello from the terminal\n');
    setTimeout(() => child.kill('SIGKILL'), 15_000).unref();
  });

  it('hands the instance the supervisor\'s stdin with input: inherit (foreground TTY)', async () => {
    expect(await run('inherit')).toContain('stdin=hello from the terminal');
  }, 20_000);

  it('keeps the instance off stdin by default (background gateway)', async () => {
    const output = await run('ignore');
    expect(output).toContain('stdin-end');
    expect(output).not.toContain('stdin=hello');
  }, 20_000);
});
