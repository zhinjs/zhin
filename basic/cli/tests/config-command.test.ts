import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CONFIG_EXIT_CODES, createConfigCommand } from '../src/commands/config.js';

const roots: string[] = [];
const previousExitCode = process.exitCode;
afterEach(async () => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const sourceRevision = 'a'.repeat(64);
const savedRevision = 'b'.repeat(64);
async function fixture(document: Record<string, unknown> = { configVersion: 2, plugins: {}, log_level: 'info', http: { host: '127.0.0.1', port: 18086, token: 'file-token' } }) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-command-'));
  roots.push(root);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const file = join(root, 'zhin.config.json');
  const source = JSON.stringify(document);
  await writeFile(file, source);
  return { root, file, source, output, errors };
}
const saved = (extra: Record<string, unknown> = {}) => ({ status: 'saved', revision: savedRevision, restartRequired: false,
  message: '配置已保存', paths: [['log_level']], missingEnv: [], ...extra });
const receipt = (groups: Array<Record<string, unknown>>) => ({ operationId: 'op-1', sourceRevision: savedRevision, saved: true,
  generation: 2, applicationRevision: 1, groups: groups.map((group, index) => ({ id: `g${index}`, paths: [['log_level']], dependsOn: [], effect: 'in-place', ...group })) });
function fakeHost(mutate: (request: Record<string, unknown>) => unknown = () => saved(), read: (request: Record<string, unknown>) => unknown = () => ({ revision: sourceRevision, path: [], exists: true, value: {}, redacted: true })) {
  const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body));
    let data: unknown;
    if (request.type === 'config:get-source') data = { source: '{}', revision: sourceRevision, format: 'json', configKeys: [] };
    else if (request.type === 'config:get-project') data = read(request);
    else data = await mutate(request);
    return new Response(JSON.stringify({ data }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const body = (fetch: ReturnType<typeof vi.fn>, index: number) => JSON.parse(String(fetch.mock.calls[index]![1]?.body));
async function run(...args: string[]) { await createConfigCommand().parseAsync(['node', 'zhin', '--json', ...args]); }
const last = (output: ReturnType<typeof vi.spyOn>) => JSON.parse(String(output.mock.calls.at(-1)?.[0]));

it('set defaults to the running Host (derived from http.*) and never writes the local file', async () => {
  const { file, source } = await fixture();
  const fetch = fakeHost();
  await run('set', 'log_level', 'debug');
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[0]![0])).toBe('http://127.0.0.1:18086/api/console/request');
  expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ authorization: 'Bearer file-token' });
  expect(body(fetch, 1)).toMatchObject({ type: 'config:patch-project', expectedRevision: sourceRevision,
    patches: [{ op: 'set', path: ['log_level'], value: 'debug' }] });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
});

it('ZHIN_CONSOLE_TOKEN wins over http.token; --host wins over http.* and keeps JSON Pointer paths', async () => {
  await fixture();
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'env-token');
  const fetch = fakeHost();
  await run('set', '/plugin/key.with.dot/0/a~1b~0c', '{"enabled":true}', '--host', 'https://host.test/custom');
  expect(String(fetch.mock.calls[1]![0])).toBe('https://host.test/custom/console/request');
  expect(fetch.mock.calls[1]![1]?.headers).toMatchObject({ authorization: 'Bearer env-token' });
  expect(body(fetch, 1).patches).toEqual([{ op: 'set', path: ['plugin', 'key.with.dot', '0', 'a/b~c'], value: { enabled: true } }]);
});

it('keeps --live as a hidden alias of --host and honours --token-env', async () => {
  await fixture();
  vi.stubEnv('CLI_TEST_TOKEN', 'named-token');
  const fetch = fakeHost();
  await run('set', 'log_level', 'debug', '--live', 'https://alias.test', '--token-env', 'CLI_TEST_TOKEN');
  expect(String(fetch.mock.calls[0]![0])).toBe('https://alias.test/api/console/request');
  expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ authorization: 'Bearer named-token' });
});

it.each(['unset', 'delete', 'del'])('%s sends one remove patch', async name => {
  await fixture();
  const fetch = fakeHost();
  await run(name, 'plugin.rows.0');
  expect(body(fetch, 1).patches).toEqual([{ op: 'remove', path: ['plugin', 'rows', '0'] }]);
});

it('a connection failure before dispatch exits 7, never falls back offline and never retries', async () => {
  const { file, source, output } = await fixture();
  const fetch = vi.fn(async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }); });
  vi.stubGlobal('fetch', fetch);
  await run('set', 'log_level', 'debug');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(last(output)).toMatchObject({ status: 'not-connected', code: 'ECONNREFUSED', message: expect.stringContaining('--offline') });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.notConnected);
});

it('reads exit 7 when the Host is not running too', async () => {
  const { output } = await fixture();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }));
  await run('get', 'log_level');
  expect(last(output).status).toBe('not-connected');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.notConnected);
});

it('a reply lost after the mutation was dispatched is unknown (exit 6), has evidence, and is not retried', async () => {
  const { file, source, output } = await fixture();
  let dispatched = 0;
  const fetch = fakeHost(() => { dispatched++; throw new Error('socket hang up after dispatch'); });
  await run('unset', 'plugin.rows.0');
  expect(dispatched).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await readFile(file, 'utf8')).toBe(source);
  const result = last(output);
  expect(result).toMatchObject({ status: 'unknown', expectedRevision: sourceRevision, requestId: body(fetch, 1).requestId });
  expect(JSON.stringify(result)).not.toContain('socket hang up');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.unknown);
});

it.each([null, {}, { status: 'invented' }, { status: 'saved', revision: 'not-a-revision' },
  saved({ application: { ...receipt([{ status: 'applied' }]), groups: [null] } }),
  { status: 'unconfirmed', expectedRevision: savedRevision, message: 'wrong evidence' },
])('a malformed mutation reply is unknown (exit 6): %j', async data => {
  const { output } = await fixture();
  const fetch = fakeHost(() => data);
  await run('set', 'log_level', 'debug');
  expect(last(output)).toMatchObject({ status: 'unknown', requestId: body(fetch, 1).requestId });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.unknown);
});

it.each([
  ['applied', saved({ application: receipt([{ status: 'applied' }]) }), CONFIG_EXIT_CODES.ok],
  ['saved without application', saved(), CONFIG_EXIT_CODES.ok],
  ['restart pending', saved({ restartRequired: true, application: receipt([{ status: 'restart-pending', effect: 'restart-process' }]) }), CONFIG_EXIT_CODES.restartPending],
  ['legacy restartRequired', saved({ restartRequired: true }), CONFIG_EXIT_CODES.restartPending],
  ['group unknown', saved({ application: receipt([{ status: 'applied' }, { status: 'unknown' }]) }), CONFIG_EXIT_CODES.unknown],
  ['application unconfirmed', saved({ applicationError: 'unconfirmed' }), CONFIG_EXIT_CODES.unknown],
  ['application invalid', saved({ applicationError: 'invalid' }), CONFIG_EXIT_CODES.invalid],
  ['group failed', saved({ application: receipt([{ status: 'failed' }]) }), CONFIG_EXIT_CODES.error],
  ['conflict', { status: 'conflict', revision: savedRevision, current: [{ path: ['log_level'], value: 'warn' }], message: 'conflict' }, CONFIG_EXIT_CODES.conflict],
  ['invalid', { status: 'invalid', revision: sourceRevision, errors: [{ path: '$.log_level', message: 'bad' }], missingEnv: [], message: 'invalid' }, CONFIG_EXIT_CODES.invalid],
  ['server unconfirmed', { status: 'unconfirmed', expectedRevision: sourceRevision, message: 'unconfirmed' }, CONFIG_EXIT_CODES.unknown],
] as const)('maps %s to its public exit code', async (_name, data, code) => {
  const { output } = await fixture();
  fakeHost(() => data);
  await run('set', 'log_level', 'debug');
  expect(last(output).status).toBe(data.status);
  expect(process.exitCode).toBe(code);
});

it('an HTTP 401/403 is an authentication failure (exit 1), distinct from unknown and never falls back', async () => {
  const { file, source, output } = await fixture();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { calls++; return new Response('{"error":"Unauthorized"}', { status: 401 }); }));
  await run('set', 'log_level', 'debug');
  expect(calls).toBe(1);
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(last(output)).toMatchObject({ status: 'unauthorized', httpStatus: 401 });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
});

it('an authoritative Host rejection of the mutation is exit 1, not unknown', async () => {
  const { output } = await fixture();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ++calls === 1
    ? new Response(JSON.stringify({ data: { source: '{}', revision: sourceRevision, format: 'json', configKeys: [] } }))
    : new Response(JSON.stringify({ error: 'Full scope required' }))));
  await run('set', 'log_level', 'debug');
  expect(calls).toBe(2);
  expect(last(output)).toMatchObject({ status: 'rejected', message: expect.stringContaining('Full scope required') });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
});

it('reads ask the Host to redact by default and only reveal on --reveal', async () => {
  const { output } = await fixture();
  const fetch = fakeHost(undefined, request => ({ revision: sourceRevision, path: request.path, exists: true,
    value: request.reveal ? 'raw-secret' : '[redacted]', redacted: !request.reveal }));
  await run('get', 'http.token');
  expect(body(fetch, 0)).toMatchObject({ type: 'config:get-project', path: ['http', 'token'], reveal: false });
  expect(last(output)).toBe('[redacted]');
  await run('get', 'http.token', '--reveal');
  expect(body(fetch, 1)).toMatchObject({ path: ['http', 'token'], reveal: true });
  expect(last(output)).toBe('raw-secret');
  await run('list');
  expect(body(fetch, 2)).toMatchObject({ path: [], reveal: false });
});

it('get of a missing path exits 1 with not-found', async () => {
  const { output } = await fixture();
  fakeHost(undefined, request => ({ revision: sourceRevision, path: request.path, exists: false, redacted: true }));
  await run('get', 'missing.key');
  expect(last(output)).toMatchObject({ status: 'not-found', path: ['missing', 'key'] });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
});

it('--offline cannot be combined with --host and never touches the network', async () => {
  const { file, source, output } = await fixture();
  const fetch = fakeHost();
  await run('set', 'log_level', 'debug', '--offline', '--host', 'http://127.0.0.1:1');
  expect(fetch).not.toHaveBeenCalled();
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(last(output).status).toBe('usage');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
});
