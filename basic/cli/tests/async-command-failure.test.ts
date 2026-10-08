import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('owns async runtime startup failure at CLI boundary and exits without an unhandled rejection', async () => {
  const root = resolve(import.meta.dirname, '../../..');
  const project = await mkdtemp(join(tmpdir(), 'zhin-cli-failure-'));
  try {
    await mkdir(join(project, 'node_modules/@zhin.js'), { recursive: true });
    await symlink(join(root, 'plugins/adapters/napcat'), join(project, 'node_modules/@zhin.js/adapter-napcat'), 'dir');
    await symlink(join(root, 'packages/im/zhin'), join(project, 'node_modules/zhin.js'), 'dir');
    await writeFile(join(project, 'plugin.ts'), "import {definePlugin} from 'zhin.js'; export default definePlugin({name:'failure-fixture'});");
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'failure-fixture', private: true, type: 'module', dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/adapter-napcat': 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', plugins: [{ package: '@zhin.js/adapter-napcat', instanceKey: 'napcat' }] } }));
    // Closed local port, dummy credentials only; never loads acceptance .env.
    await writeFile(join(project, 'zhin.config.yml'), 'plugins:\n  napcat:\n    connection: ws\n    endpoints:\n      - id: fixture\n        url: ws://127.0.0.1:1\n        access_token: fixture\nhttp:\n  host: 127.0.0.1\n  port: 0\n');
    const result = await promisify(execFile)(process.execPath, [join(root, 'basic/cli/bin/zhin.js'), 'runtime', 'start', '--once'], { cwd: project, timeout: 15000 }).catch(error => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/zhin: connect (?:ECONNREFUSED|EPERM)/);
    expect(result.stderr).not.toContain('triggerUncaughtException');
    expect(result.stderr).not.toContain('UnhandledPromiseRejection');
  } finally { await rm(project, { recursive: true, force: true }); }
}, 20000);

it('owns published QQ SDK authentication failure through full dummy CLI startup', async () => {
  const { createServer } = await import('node:http');
  const root = resolve(import.meta.dirname, '../../..');
  const project = await mkdtemp(join(tmpdir(), 'zhin-cli-qq-auth-'));
  const auth = createServer((_request, response) => { response.writeHead(403, { 'Content-Type': 'application/json' }); response.end('{"code":403,"message":"fixture auth denied"}'); });
  await new Promise<void>(done => auth.listen(0, '127.0.0.1', done));
  try {
    const address = auth.address() as { port: number };
    await mkdir(join(project, 'node_modules/@zhin.js'), { recursive: true });
    await symlink(join(root, 'plugins/adapters/qq'), join(project, 'node_modules/@zhin.js/adapter-qq'), 'dir');
    await symlink(join(root, 'packages/im/zhin'), join(project, 'node_modules/zhin.js'), 'dir');
    await writeFile(join(project, 'plugin.ts'), "import {definePlugin} from 'zhin.js'; export default definePlugin({name:'qq-auth-fixture'});");
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'qq-auth-fixture', private: true, type: 'module', dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/adapter-qq': 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', plugins: [{ package: '@zhin.js/adapter-qq', instanceKey: 'qq' }] } }));
    await writeFile(join(project, 'zhin.config.yml'), `plugins:\n  qq:\n    mode: websocket\n    endpoints:\n      - id: fixture\n        appid: dummy\n        secret: dummy\n        accessTokenUrl: http://127.0.0.1:${address.port}/token\nhttp:\n  host: 127.0.0.1\n  port: 0\n`);
    const result = await promisify(execFile)(process.execPath, [join(root, 'basic/cli/bin/zhin.js'), 'runtime', 'start', '--once'], { cwd: project, timeout: 15000, env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' } }).catch(error => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('zhin: QQ WebSocket');
    expect(result.stderr).toContain('403');
    expect(result.stderr).not.toContain('triggerUncaughtException');
    expect(result.stderr).not.toContain('startup timed out');
  } finally { await new Promise<void>(done => auth.close(() => done())); await rm(project, { recursive: true, force: true }); }
}, 20000);
