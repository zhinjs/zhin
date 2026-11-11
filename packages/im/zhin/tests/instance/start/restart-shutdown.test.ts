import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve('.');
const fixtureSource = join(repo, 'examples/minimal-bot');
const tsx = pathToFileURL(join(repo, 'node_modules/tsx/dist/esm/index.mjs')).href;
const entry = pathToFileURL(join(repo, 'packages/im/zhin/src/instance/start-command.ts')).href;
const lifecycleEntry = pathToFileURL(join(repo, 'packages/im/zhin/src/instance/process-lifecycle.ts')).href;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer().once('error', () => done(false)).listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

function withoutGatewayMarker(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ZHIN_RUNTIME_CHILD: _marker, ...rest } = env;
  return rest;
}

interface GatewayRun { code: number | null; output: string; killed: boolean; messages: { type: string; payload: unknown }[] }

/**
 * Starts the real process composition under a stand-in gateway (IPC, advanced serialization),
 * requests a Console restart and answers the instance's `restart-request` with `shutdown`
 * (ADR 0054 §3), then waits for a natural exit.
 */
function startAndRestart(root: string, port: number, mode: 'restart' | 'early-restart' | 'disconnect' | 'foreign-ipc' = 'restart'): Promise<GatewayRun> {
  const script = `
    import { runStartCommand } from ${JSON.stringify(entry)};
    const request = async () => {
      for (;;) {
        try {
          const response = await fetch('http://127.0.0.1:${port}/api/console/request', {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer restart-token' },
            body: JSON.stringify({ type: 'system:restart', requestId: 'restart' }),
          });
          if (response.ok) { console.error('restart-requested'); return; }
        } catch {}
        await new Promise(done => setTimeout(done, 200).unref());
      }
    };
    // The stand-in gateway says go once it saw \`ready\`.
    process.on('message', message => { if (message?.type === 'test:go') void request(); });
    if (process.env.TEST_REQUEST_EARLY) void request();
    await runStartCommand({ root: ${JSON.stringify(root)}, args: ['--no-watch'], writeOutput: () => {}, writeError: value => process.stderr.write(value) });
    // The caller keeps its process after an unsupervised stop: nothing may force an exit.
    if (process.env.TEST_FOREIGN_IPC) await new Promise(done => setTimeout(done, 600));
    console.error('caller-still-alive');
    // A foreign parent's IPC channel stays referenced (it is not ours to unref); let go of it.
    if (process.env.TEST_FOREIGN_IPC) process.disconnect?.();
  `;
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced',
      env: mode === 'foreign-ipc'
        // Another parent's IPC channel (a test runner's fork worker, a process manager).
        ? { ...withoutGatewayMarker(process.env), TEST_REQUEST_EARLY: '1', TEST_FOREIGN_IPC: '1' }
        : { ...process.env, ZHIN_RUNTIME_CHILD: '1', ...(mode === 'early-restart' ? { TEST_REQUEST_EARLY: '1' } : {}) },
    });
    let output = '';
    let killed = false;
    const messages: GatewayRun['messages'] = [];
    child.stdout!.on('data', chunk => { output += String(chunk); });
    child.stderr!.on('data', chunk => { output += String(chunk); });
    child.on('message', (message: { type: string; payload: unknown }) => {
      messages.push(message);
      if (message.type === 'restart-request') child.send({ type: 'shutdown', payload: { reason: 'restart', budgetMs: 5_000 } });
      if (message.type === 'ready' && mode === 'disconnect') child.disconnect();
      if (message.type === 'ready' && mode === 'restart') child.send({ type: 'test:go', payload: {} });
    });
    // A lingering handle would keep the process alive after stop(); fail instead of hanging.
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 30_000);
    child.once('error', reject);
    // `exit`, not `close`: after the gateway disconnects, the IPC handle never reports `close`.
    child.once('exit', code => {
      clearTimeout(timer);
      setTimeout(() => { done({ code, output, killed, messages }); }, 100);
    });
  });
}

describe('process restart shutdown', () => {
  it('requests the restart from the gateway, stops on shutdown without lingering handles and frees the port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-restart-'));
    roots.push(root);
    await cp(join(fixtureSource, 'package.json'), join(root, 'package.json'));
    await cp(join(fixtureSource, 'plugin.ts'), join(root, 'plugin.ts'));
    await symlink(join(fixtureSource, 'node_modules'), join(root, 'node_modules'), 'junction');
    const port = await freePort();
    // No http.token and no owner: the local Host is open before setup (ADR 0049), so the
    // restart RPC needs no credential. A bootstrap token would only reach /auth/setup.
    await writeFile(join(root, 'zhin.config.yml'), `configVersion: 2\nplugins: {}\nhttp:\n  host: 127.0.0.1\n  port: ${port}\n`);

    for (const attempt of [1, 2]) {
      const result = await startAndRestart(root, port);
      expect(result.killed, `attempt ${attempt} hung:\n${result.output}`).toBe(false);
      expect(result.output).toContain('restart-requested');
      expect(result.output).not.toContain('EADDRINUSE');
      expect(result.messages.map(message => message.type)).toEqual(['ready', 'restart-request']);
      expect(result.messages[0]!.payload).toMatchObject({ version: 1, generation: expect.any(Number) });
      expect(result.messages[1]!.payload).toEqual({ reason: 'console' });
      expect(result.code, result.output).toBe(0);
      expect(await portIsFree(port)).toBe(true);
    }
  }, 120_000);

  it('a shutdown answering a restart requested while the first generation is still starting exits cleanly (#742)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-restart-slow-'));
    roots.push(root);
    await cp(join(fixtureSource, 'package.json'), join(root, 'package.json'));
    // HTTP listens before host.start() finishes; a slow plugin setup makes the
    // restart request deterministically land inside the start transaction.
    await writeFile(join(root, 'plugin.ts'), slowStartPlugin);
    await symlink(join(fixtureSource, 'node_modules'), join(root, 'node_modules'), 'junction');
    const port = await freePort();
    await writeFile(join(root, 'zhin.config.yml'), `configVersion: 2\nplugins: {}\nhttp:\n  host: 127.0.0.1\n  port: ${port}\n`);
    const result = await startAndRestart(root, port, 'early-restart');
    expect(result.killed, result.output).toBe(false);
    expect(result.output).toContain('restart-requested');
    expect(result.output).not.toContain('Root lifecycle is stopping');
    expect(result.messages.map(message => message.type)).toEqual(['restart-request']);
    expect(result.code, result.output).toBe(0);
    expect(await portIsFree(port)).toBe(true);
  }, 60_000);

  it('ignores an IPC channel the gateway did not open and stops without exiting the caller', async () => {
    // Regression (CI fork-worker crash): under a test runner's fork worker the instance took the
    // runner's IPC channel for the gateway; an unsupervised restart request then exited the worker.
    const { root, port } = await project();
    // Open local Host (no http.token, no owner) so the restart RPC needs no credential.
    await writeFile(join(root, 'zhin.config.yml'), `configVersion: 2\nplugins: {}\nhttp:\n  host: 127.0.0.1\n  port: ${port}\n`);
    const result = await startAndRestart(root, port, 'foreign-ipc');
    expect(result.killed, result.output).toBe(false);
    expect(result.messages).toEqual([]);
    expect(result.output).toContain('restartUnavailable');
    expect(result.output).toContain('caller-still-alive');
    expect(result.code, result.output).toBe(0);
    expect(await portIsFree(port)).toBe(true);
  }, 60_000);

  it('stops when the gateway disconnects (no orphaned instance)', async () => {
    const { root, port } = await project();
    const result = await startAndRestart(root, port, 'disconnect');
    expect(result.killed, result.output).toBe(false);
    expect(result.messages.map(message => message.type)).toEqual(['ready']);
    expect(result.output).toContain('gateway disconnected');
    expect(result.code, result.output).toBe(0);
    expect(await portIsFree(port)).toBe(true);
  }, 60_000);
});

const slowStartPlugin = `import { definePlugin } from 'zhin.js';
export default definePlugin({
  name: 'slow-start',
  async setup() {
    await new Promise(resolve => setTimeout(resolve, 1_500));
  },
});
`;

const hangingPlugin = `import { definePlugin } from 'zhin.js';
export default definePlugin({
  name: 'hanging-stop',
  setup() {
    // Simulates a component whose disposal never settles and holds a live handle.
    return () => new Promise(() => { setInterval(() => {}, 1_000); });
  },
});
`;

async function project(options: { hang?: boolean; slow?: boolean } = {}): Promise<{ root: string; port: number }> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-signal-'));
  roots.push(root);
  await cp(join(fixtureSource, 'package.json'), join(root, 'package.json'));
  if (options.hang) await writeFile(join(root, 'plugin.ts'), hangingPlugin);
  else if (options.slow) await writeFile(join(root, 'plugin.ts'), slowStartPlugin);
  else await cp(join(fixtureSource, 'plugin.ts'), join(root, 'plugin.ts'));
  await symlink(join(fixtureSource, 'node_modules'), join(root, 'node_modules'), 'junction');
  const port = await freePort();
  await writeFile(join(root, 'zhin.config.yml'), `configVersion: 2\nplugins: {}\nhttp:\n  host: 127.0.0.1\n  port: ${port}\n  token: restart-token\n`);
  return { root, port };
}

/** Starts the real process, waits for its real signal-listener registration, then delivers the given signals. */
function startAndSignal(root: string, signals: readonly NodeJS.Signals[], gapMs = 0) {
  const script = `
    import { runStartCommand } from ${JSON.stringify(entry)};
    import { nodeProcessLifecycleAdapter } from ${JSON.stringify(lifecycleEntry)};
    const registerSignal = nodeProcessLifecycleAdapter.on;
    nodeProcessLifecycleAdapter.on = (signal, listener) => {
      registerSignal(signal, listener);
      if (signal === 'SIGINT') process.stdout.write('test:signals-ready\\n');
    };
    await runStartCommand({ root: ${JSON.stringify(root)}, args: ['--no-watch'], writeOutput: value => process.stdout.write(value), writeError: value => process.stderr.write(value) });
  `;
  return new Promise<{ code: number | null; output: string; elapsedMs: number; killed: boolean }>((done, reject) => {
    const child = spawn(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    });
    let output = '';
    let killed = false;
    let signalledAt = 0;
    const started = new Promise<void>(resolve => {
      child.stdout.on('data', chunk => {
        output += String(chunk);
        if (output.includes('test:signals-ready\n')) resolve();
      });
    });
    child.stderr.on('data', chunk => { output += String(chunk); });
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 45_000);
    void (async () => {
      // Both HTTP and startup output precede listener installation. Observe the
      // real process adapter registration instead of guessing a startup delay.
      await started;
      signalledAt = Date.now();
      for (const [index, signal] of signals.entries()) {
        if (index > 0) await new Promise(r => setTimeout(r, gapMs));
        child.kill(signal);
      }
    })();
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); done({ code, output, killed, elapsedMs: Date.now() - signalledAt }); });
  });
}

describe.skipIf(process.platform === 'win32')('process signal shutdown', () => {
  it('waits for actual startup when HTTP listens before a slow generation is ready', async () => {
    const { root, port } = await project({ slow: true });
    const result = await startAndSignal(root, ['SIGINT']);
    expect(result.killed, result.output).toBe(false);
    expect(result.code, result.output).toBe(0);
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(await portIsFree(port)).toBe(true);
  }, 60_000);

  it('stops gracefully on SIGINT and frees the port', async () => {
    const { root, port } = await project();
    const result = await startAndSignal(root, ['SIGINT']);
    expect(result.killed, result.output).toBe(false);
    expect(result.code, result.output).toBe(0);
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(result.output).not.toContain('forcedExit');
    expect(await portIsFree(port)).toBe(true);
  }, 60_000);

  it('force-exits a hanging stop after the 5s budget and names what was still stopping', async () => {
    const { root, port } = await project({ hang: true });
    const result = await startAndSignal(root, ['SIGINT']);
    expect(result.killed, result.output).toBe(false);
    expect(result.code, result.output).toBe(130);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(4_500);
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(result.output).toContain('"forcedExit":"budget"');
    expect(result.output).toContain('"runtime"');
  }, 60_000);

  it('exits immediately on a second SIGINT during a hanging stop', async () => {
    const { root, port } = await project({ hang: true });
    const result = await startAndSignal(root, ['SIGINT', 'SIGINT'], 300);
    expect(result.killed, result.output).toBe(false);
    expect(result.code, result.output).toBe(130);
    expect(result.elapsedMs).toBeLessThan(3_000);
    expect(result.output).toContain('"forcedExit":"repeated-signal"');
  }, 60_000);
});
