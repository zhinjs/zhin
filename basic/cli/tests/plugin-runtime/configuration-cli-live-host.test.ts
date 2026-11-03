import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repo = resolve(import.meta.dirname, '../../../..');
const cli = join(repo, 'basic/cli/bin/zhin.js');
const token = 'synthetic-configuration-cli-token';

it('built CLI uses the live Host with watch disabled, keeps pending transport, and does not replay a lost save response', async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-cli-live-')));
  let host: ChildProcess | undefined;
  let output = '';
  let hostUrl = '';
  let proxyWrites = 0;
  const proxy = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = [];
      for await (const chunk of request) parts.push(Buffer.from(chunk));
      const body = Buffer.concat(parts).toString('utf8');
      const result = await fetch(`${hostUrl}/api/console/request`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body,
        signal: AbortSignal.timeout(10000),
      });
      const reply = await result.text();
      if (JSON.parse(body).type === 'config:patch-project') {
        proxyWrites++;
        // The real Host has completed saving/applying; only the caller's response is lost.
        response.destroy();
      } else { response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(reply); }
    } catch { response.destroy(); }
  });
  const file = join(project, 'zhin.config.json');
  try {
    await mkdir(join(project, 'node_modules'), { recursive: true });
    await symlink(join(repo, 'packages/im/zhin'), join(project, 'node_modules/zhin.js'), 'dir');
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'configuration-cli-live', private: true, type: 'module',
      dependencies: { 'zhin.js': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', features: [], plugins: [] } }));
    await writeFile(join(project, 'plugin.ts'), "import {definePlugin} from 'zhin.js'; export default definePlugin({name:'configuration-cli-live'});\n");
    await writeFile(file, JSON.stringify({ configVersion: 2, plugins: {}, ai: { enabled: false },
      menuKeyword: 'Before', http: { host: '127.0.0.1', port: 0, token } }));
    host = spawn(process.execPath, [cli, 'runtime', 'start'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
    host.stdout!.on('data', chunk => { output += String(chunk); });
    host.stderr!.on('data', chunk => { output += String(chunk); });
    hostUrl = await new Promise<string>((done, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Host did not start: ${output}`)); }, 20000);
      const check = () => { const address = /listening (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1]; if (address) { cleanup(); done(address); } };
      const exited = () => { cleanup(); reject(new Error(`Host exited: ${output}`)); };
      const cleanup = () => { clearTimeout(timeout); host!.stdout!.off('data', check); host!.stderr!.off('data', check); host!.off('exit', exited); };
      host!.stdout!.on('data', check); host!.stderr!.on('data', check); host!.once('exit', exited); check();
    });
    const deadline = Date.now() + 15000;
    while (!(await fetch(`${hostUrl}/pub/ready`, { signal: AbortSignal.timeout(1000) })).ok) {
      if (Date.now() > deadline || host.exitCode !== null) throw new Error(`Host not ready: ${output}`);
      await new Promise(done => setTimeout(done, 25));
    }
    const run = async (args: string[], target = hostUrl) => {
      const options = { cwd: project, env: { ...process.env, ZHIN_CONFIG_CLI_TEST_TOKEN: token }, timeout: 20000 };
      try {
        const result = await execute(process.execPath, [cli, 'config', '--json', '--live', target, '--token-env', 'ZHIN_CONFIG_CLI_TEST_TOKEN', ...args], options);
        return { code: 0, data: JSON.parse(result.stdout) };
      } catch (error) {
        const failed = error as { code?: unknown; stdout?: string; stderr?: string };
        if (!failed.stdout) throw new Error(`CLI failed without receipt: ${failed.stderr ?? String(error)}`, { cause: error });
        return { code: failed.code, data: JSON.parse(failed.stdout) };
      }
    };
    const pid = host.pid;
    const before = await run(['status']);
    const changed = await run(['set', 'menuKeyword', 'After']);
    expect(changed.code).toBe(0);
    expect(changed.data).toMatchObject({ status: 'saved', application: { sourceRevision: changed.data.revision } });
    expect(changed.data.application.generation).toBeGreaterThan(before.data.application.generation);
    expect((await run(['get', 'menuKeyword'])).data).toBe('After');
    const validSource = await readFile(file, 'utf8');
    const invalid = await run(['set', 'menuKeyword', '{}']);
    expect(invalid).toMatchObject({ code: 1, data: { status: 'invalid' } });
    expect(await readFile(file, 'utf8')).toBe(validSource);
    expect(await run(['apply', '--expected-revision', before.data.revision])).toMatchObject({ code: 1, data: { status: 'conflict' } });
    const pending = await run(['set', 'http.port', '65002']);
    expect(pending.data).toMatchObject({ status: 'saved', restartRequired: true });
    expect(pending.data.application.groups).toContainEqual(expect.objectContaining({ effect: 'restart-process', status: 'restart-pending' }));
    expect((await fetch(`${hostUrl}/pub/ready`)).ok).toBe(true);
    await new Promise<void>((done, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', done); });
    const lost = await run(['set', 'menuKeyword', 'Saved despite lost response'], `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`);
    expect(lost).toMatchObject({ code: 1, data: { status: 'unconfirmed', requestId: expect.any(String) } });
    expect(proxyWrites).toBe(1);
    const status = await run(['status']);
    expect(status.data.revision).not.toBe(lost.data.expectedRevision);
    expect(status.data.application.sourceRevision).toBe(status.data.revision);
    expect((await run(['get', 'menuKeyword'])).data).toBe('Saved despite lost response');
    expect(JSON.parse(await readFile(file, 'utf8')).http.port).toBe(65002);
    expect(host.pid).toBe(pid); expect(host.exitCode).toBeNull();
  } finally {
    proxy.closeAllConnections();
    if (proxy.listening) await new Promise<void>(done => proxy.close(() => done()));
    if (host && host.exitCode === null) {
      const stopped = once(host, 'exit'); host.kill('SIGTERM');
      const timeout = setTimeout(() => host!.kill('SIGKILL'), 5000);
      try { await stopped; } finally { clearTimeout(timeout); }
    }
    await rm(project, { recursive: true, force: true });
  }
}, 90000);
