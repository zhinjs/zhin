import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve('.');
const fixtureSource = join(repo, 'examples/minimal-bot');
const tsx = pathToFileURL(join(repo, 'node_modules/tsx/dist/esm/index.mjs')).href;
const entry = pathToFileURL(join(repo, 'basic/cli/src/plugin-runtime/start-command.ts')).href;
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

/** Starts the real process composition, requests a Console restart, and waits for a natural exit. */
function startAndRestart(root: string, port: number): Promise<{ code: number | null; output: string; killed: boolean }> {
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
    void request();
    await runStartCommand({ root: ${JSON.stringify(root)}, args: ['--no-watch'], writeOutput: () => {}, writeError: value => process.stderr.write(value) });
  `;
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ZHIN_SUPERVISOR_PID: String(process.pid) },
    });
    let output = '';
    let killed = false;
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    // A lingering handle would keep the process alive after stop(); fail instead of hanging.
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 45_000);
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); done({ code, output, killed }); });
  });
}

describe('process restart shutdown', () => {
  it('exits with the restart code without lingering handles and frees the port for the next start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-restart-'));
    roots.push(root);
    await cp(join(fixtureSource, 'package.json'), join(root, 'package.json'));
    await cp(join(fixtureSource, 'plugin.ts'), join(root, 'plugin.ts'));
    await symlink(join(fixtureSource, 'node_modules'), join(root, 'node_modules'), 'junction');
    const port = await freePort();
    await writeFile(join(root, 'zhin.config.yml'), `plugins: {}\nhttp:\n  host: 127.0.0.1\n  port: ${port}\n  token: restart-token\n`);

    for (const attempt of [1, 2]) {
      const result = await startAndRestart(root, port);
      expect(result.killed, `attempt ${attempt} hung:\n${result.output}`).toBe(false);
      expect(result.output).toContain('restart-requested');
      expect(result.output).not.toContain('EADDRINUSE');
      expect(result.code, result.output).toBe(75);
      expect(await portIsFree(port)).toBe(true);
    }
  }, 120_000);
});

const hangingPlugin = `import { definePlugin } from 'zhin.js';
export default definePlugin({
  name: 'hanging-stop',
  setup() {
    // Simulates a component whose disposal never settles and holds a live handle.
    return () => new Promise(() => { setInterval(() => {}, 1_000); });
  },
});
`;

async function project(options: { hang?: boolean } = {}): Promise<{ root: string; port: number }> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-signal-'));
  roots.push(root);
  await cp(join(fixtureSource, 'package.json'), join(root, 'package.json'));
  if (options.hang) await writeFile(join(root, 'plugin.ts'), hangingPlugin);
  else await cp(join(fixtureSource, 'plugin.ts'), join(root, 'plugin.ts'));
  await symlink(join(fixtureSource, 'node_modules'), join(root, 'node_modules'), 'junction');
  const port = await freePort();
  await writeFile(join(root, 'zhin.config.yml'), `plugins: {}\nhttp:\n  host: 127.0.0.1\n  port: ${port}\n  token: restart-token\n`);
  return { root, port };
}

/** Starts the real process, waits for HTTP readiness, then delivers the given signals. */
function startAndSignal(root: string, port: number, signals: readonly NodeJS.Signals[], gapMs = 0) {
  const script = `
    import { runStartCommand } from ${JSON.stringify(entry)};
    await runStartCommand({ root: ${JSON.stringify(root)}, args: ['--no-watch'], writeOutput: () => {}, writeError: value => process.stderr.write(value) });
  `;
  return new Promise<{ code: number | null; output: string; elapsedMs: number; killed: boolean }>((done, reject) => {
    const child = spawn(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ZHIN_SUPERVISOR_PID: String(process.pid) },
    });
    let output = '';
    let killed = false;
    let signalledAt = 0;
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 45_000);
    void (async () => {
      for (;;) {
        try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 200)); }
      }
      // Give the runtime time to finish start-up after HTTP listens.
      await new Promise(r => setTimeout(r, 1_000));
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
  it('stops gracefully on SIGINT and frees the port', async () => {
    const { root, port } = await project();
    const result = await startAndSignal(root, port, ['SIGINT']);
    expect(result.killed, result.output).toBe(false);
    expect(result.code, result.output).toBe(0);
    expect(result.elapsedMs).toBeLessThan(5_000);
    expect(result.output).not.toContain('forcedExit');
    expect(await portIsFree(port)).toBe(true);
  }, 60_000);

  it('force-exits a hanging stop after the 5s budget and names what was still stopping', async () => {
    const { root, port } = await project({ hang: true });
    const result = await startAndSignal(root, port, ['SIGINT']);
    expect(result.killed, result.output).toBe(false);
    expect(result.code, result.output).toBe(130);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(4_500);
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(result.output).toContain('"forcedExit":"budget"');
    expect(result.output).toContain('"runtime"');
  }, 60_000);

  it('exits immediately on a second SIGINT during a hanging stop', async () => {
    const { root, port } = await project({ hang: true });
    const result = await startAndSignal(root, port, ['SIGINT', 'SIGINT'], 300);
    expect(result.killed, result.output).toBe(false);
    expect(result.code, result.output).toBe(130);
    expect(result.elapsedMs).toBeLessThan(3_000);
    expect(result.output).toContain('"forcedExit":"repeated-signal"');
  }, 60_000);
});
