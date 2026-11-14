import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigDocument } from '@zhin.js/runtime';
import { createConsoleEventHub } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import { withTestUsers } from '../utils/console-users.js';
import type { ConsoleConfigApplication } from '@zhin.js/console-protocol';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { registerConsoleRpcRoute } from '../../../src/instance/console/rpc-route.js';
import { ConsoleConfigurationStore } from '../../../../../host/gateway/src/config/configuration.js';
import { createPluginLifecycleStore, resolvePluginLifecycleFile } from '@zhin.js/runtime';
import { CONFIG_EXIT_CODES, createConfigCommand } from '../../../../../../basic/cli/src/commands/config.js';
import { ConsoleRpcError, ConsoleRequestUnconfirmedError, requestPluginConsole } from '../../../../../../basic/cli/src/plugin-management/console-client.js';

const token = 'synthetic-full-token';
const previousExitCode = process.exitCode;
let root = '';
let file = '';
let host = '';
let http: ReturnType<typeof createHttpHost> | undefined;
let proxy: Server | undefined;
let output: ReturnType<typeof vi.spyOn>;
let generation = 1;
let appliedDocument: Record<string, unknown> = {};

const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
/** Leaf paths whose value differs between two documents: the receipt reports exactly what changed. */
function changedPaths(before: unknown, after: unknown, prefix: readonly string[] = []): string[][] {
  if (plain(before) && plain(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .flatMap(key => changedPaths(before[key], after[key], [...prefix, key]));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [[...prefix]];
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-config-cli-live-')));
  file = join(root, 'zhin.config.json');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'config-cli-live', version: '1.0.0', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false } }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  appliedDocument = { configVersion: 2, plugins: {}, log_level: 'info', menuKeyword: 'Before',
    ai: { enabled: false, providers: { main: { apiKey: '${MAIN_KEY}' } } }, http: { host: '127.0.0.1', port: 18086, token: 'stored-http-token' } };
  await writeFile(file, JSON.stringify(appliedDocument));
  // Host-side apply is faked: Host-section `http` edits need a restart, everything else applies in place.
  const applyConfiguration = vi.fn(async (expectedRevision?: string): Promise<ConsoleConfigApplication> => {
    const current = await createConfigDocument(file).read();
    const next = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    const restart = (next.http as { port?: unknown }).port !== 18086;
    const paths = changedPaths(appliedDocument, next);
    appliedDocument = next;
    return { operationId: `op-${generation}`, sourceRevision: expectedRevision ?? current.revision, saved: true, generation: ++generation,
      applicationRevision: generation, groups: [{ id: 'main', paths, dependsOn: [],
        effect: restart ? 'restart-process' : 'in-place', status: restart ? 'restart-pending' : 'applied' }] };
  });
  http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { [token]: 'owner' });
  registerConsoleRpcRoute({ http, base: '/api', projectRoot: root, consoleRuntime: { runView: async () => ({ pages: [] }) } as unknown as ConsoleRuntime,
    hub: createConsoleEventHub(), pluginLifecycleFile: resolvePluginLifecycleFile(root), pluginLifecycleStore: createPluginLifecycleStore(root),
    configuration: new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(file), applyConfiguration }),
  } as Parameters<typeof registerConsoleRpcRoute>[0]);
  host = `http://127.0.0.1:${(await http.listen()).port}`;
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', token);
});

afterEach(async () => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (proxy?.listening) { proxy.closeAllConnections(); await new Promise<void>(done => proxy!.close(() => done())); }
  proxy = undefined;
  await http?.close().catch(() => {});
  http = undefined;
  await rm(root, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ code: number; data: unknown }> {
  process.exitCode = undefined;
  // The Host here is a bare instance HTTP server without a gateway: it reports no project id on
  // /pub/health, which the CLI refuses on loopback unless --allow-unverified-host (#1250).
  await createConfigCommand().parseAsync(['node', 'zhin', '--json', '--host', host, '--allow-unverified-host', ...args]);
  return { code: (process.exitCode ?? 0) as number, data: JSON.parse(String(output.mock.calls.at(-1)?.[0])) };
}

describe('zhin config against a real Host HTTP control plane', () => {
  it('get/list mask schema secrets and environment references unless --reveal', async () => {
    expect(await run('get', 'http.token')).toEqual({ code: 0, data: '[redacted]' });
    expect(await run('get', 'ai.providers.main.apiKey')).toEqual({ code: 0, data: '[redacted]' });
    expect(await run('get', 'menuKeyword')).toEqual({ code: 0, data: 'Before' });
    const listed = await run('list');
    expect(listed.data).toMatchObject({ menuKeyword: 'Before', log_level: 'info', http: { token: '[redacted]', port: 18086 } });
    expect(JSON.stringify(listed.data)).not.toContain('stored-http-token');
    expect(JSON.stringify(listed.data)).not.toContain('MAIN_KEY');
    expect(await run('get', 'http.token', '--reveal')).toEqual({ code: 0, data: 'stored-http-token' });
    expect(await run('get', 'missing')).toMatchObject({ code: CONFIG_EXIT_CODES.error, data: { status: 'not-found' } });
  });

  it('set/unset save through the Host and map the application receipt to exit codes', async () => {
    const applied = await run('set', 'menuKeyword', 'After');
    expect(applied).toMatchObject({ code: CONFIG_EXIT_CODES.ok, data: { status: 'saved', paths: [['menuKeyword']],
      application: { groups: [{ status: 'applied', paths: [['menuKeyword']] }] } } });
    expect(JSON.parse(await readFile(file, 'utf8')).menuKeyword).toBe('After');
    expect((await run('get', 'menuKeyword')).data).toBe('After');
    expect(await run('unset', 'menuKeyword')).toMatchObject({ code: CONFIG_EXIT_CODES.ok, data: { status: 'saved', paths: [['menuKeyword']],
      application: { groups: [{ paths: [['menuKeyword']] }] } } });
    expect(JSON.parse(await readFile(file, 'utf8'))).not.toHaveProperty('menuKeyword');
    const pending = await run('set', 'http.port', '18087');
    expect(pending).toMatchObject({ code: CONFIG_EXIT_CODES.restartPending, data: { status: 'saved', restartRequired: true, paths: [['http', 'port']],
      application: { groups: [{ status: 'restart-pending', paths: [['http', 'port']] }] } } });
  });

  it('invalid values and declaration writes are invalid (exit 5) with field paths and leave the file unchanged', async () => {
    const before = await readFile(file, 'utf8');
    const invalid = await run('set', 'log_level', '{"not":"a level"}');
    expect(invalid).toMatchObject({ code: CONFIG_EXIT_CODES.invalid, data: { status: 'invalid', errors: [expect.objectContaining({ path: expect.stringContaining('log_level') })] } });
    expect(await run('set', 'plugins.extra', '"extra"')).toMatchObject({ code: CONFIG_EXIT_CODES.invalid, data: { status: 'invalid' } });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('an external edit between the revision read and the write is a conflict (exit 4)', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      const response = await realFetch(url, init);
      if (JSON.parse(String(init?.body)).type === 'config:get-source') {
        const document = JSON.parse(await readFile(file, 'utf8'));
        await writeFile(file, JSON.stringify({ ...document, menuKeyword: 'External' }));
      }
      return response;
    }));
    const result = await run('set', 'menuKeyword', 'Mine');
    expect(result).toMatchObject({ code: CONFIG_EXIT_CODES.conflict, data: { status: 'conflict', current: [{ path: ['menuKeyword'], value: 'External' }] } });
    expect(JSON.parse(await readFile(file, 'utf8')).menuKeyword).toBe('External');
  });

  it('a Host that is not running exits 7 and leaves the file bytes unchanged', async () => {
    const before = await readFile(file, 'utf8');
    await http!.close();
    http = undefined;
    expect(await run('set', 'menuKeyword', 'After')).toMatchObject({ code: CONFIG_EXIT_CODES.notConnected, data: { status: 'not-connected' } });
    expect(await run('get', 'menuKeyword')).toMatchObject({ code: CONFIG_EXIT_CODES.notConnected });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('a response lost after the Host received the write exits 6 after exactly one write request', async () => {
    let writes = 0;
    const direct = host;
    proxy = createServer(async (request, response) => {
      if (request.method === 'GET') {
        // The CLI's loopback identity probe (/pub/health) passes through unchanged (#1250).
        const probed = await fetch(`${direct}${request.url ?? '/'}`);
        response.writeHead(probed.status, { 'content-type': 'application/json' }).end(await probed.text());
        return;
      }
      const parts: Buffer[] = [];
      for await (const chunk of request) parts.push(Buffer.from(chunk));
      const body = Buffer.concat(parts).toString('utf8');
      const forwarded = await fetch(`${direct}/api/console/request`, { method: 'POST', body,
        headers: { authorization: String(request.headers.authorization), 'content-type': 'application/json' } });
      const reply = await forwarded.text();
      if (JSON.parse(body).type === 'config:patch-project') { writes++; response.destroy(); return; }
      response.writeHead(forwarded.status, { 'content-type': 'application/json' }).end(reply);
    });
    await new Promise<void>(done => proxy!.listen(0, '127.0.0.1', done));
    host = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const lost = await run('set', 'menuKeyword', 'Saved despite lost reply');
    expect(lost).toMatchObject({ code: CONFIG_EXIT_CODES.unknown, data: { status: 'unknown', requestId: expect.any(String) } });
    expect(writes).toBe(1);
    host = direct;
    // The Host did save; the CLI neither retried nor wrote locally.
    expect((await run('get', 'menuKeyword')).data).toBe('Saved despite lost reply');
  });

  it('the real route echoes requestId on its HTTP 400 rejection, so only that is authoritative', async () => {
    const malformed = { type: 'config:patch-project', expectedRevision: 'not-a-revision', patches: [] };
    await expect(requestPluginConsole(host, malformed, 'ZHIN_CONSOLE_TOKEN', { requestId: 'req-authoritative' }))
      .rejects.toBeInstanceOf(ConsoleRpcError);
    // The same rejection behind a gateway that rewrites it to 502 proves nothing about execution.
    const direct = host;
    proxy = createServer(async (request, response) => {
      for await (const _chunk of request) { /* drain */ }
      response.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"Bad Gateway"}');
    });
    await new Promise<void>(done => proxy!.listen(0, '127.0.0.1', done));
    host = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    await expect(requestPluginConsole(host, malformed, 'ZHIN_CONSOLE_TOKEN', { requestId: 'req-gateway' }))
      .rejects.toMatchObject({ name: ConsoleRequestUnconfirmedError.name, requestId: 'req-gateway', httpStatus: 502 });
    host = direct;
  });

  it('a rejected token is an authentication failure and never falls back offline', async () => {
    const before = await readFile(file, 'utf8');
    vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'wrong-token');
    const result = await run('set', 'menuKeyword', 'After');
    expect(result.code).toBe(CONFIG_EXIT_CODES.error);
    expect(result.data).toMatchObject({ status: 'unauthorized' });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('refuses plaintext credentials to a non-loopback Host', async () => {
    host = 'http://example.invalid';
    await expect(run('get', 'menuKeyword')).rejects.toThrow(/HTTPS/);
  });
});
