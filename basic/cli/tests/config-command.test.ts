import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { projectIdentity } from '@zhin.js/gateway/project';
import { CONFIG_EXIT_CODES, createConfigCommand } from '../src/commands/config.js';

/** Whether this project's gateway "runs": its local-socket fetch delegates to the stubbed global fetch. */
const gateway = vi.hoisted(() => ({ running: true }));
vi.mock('@zhin.js/gateway/local', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zhin.js/gateway/local')>(),
  probeLocalGateway: async () => (gateway.running ? { ok: true } : undefined),
  createLocalGatewayFetch: () => ((url: unknown, init?: RequestInit) => globalThis.fetch(url as string, init)),
}));

const roots: string[] = [];
const previousExitCode = process.exitCode;
afterEach(async () => {
  gateway.running = true;
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
async function runHuman(...args: string[]) { await createConfigCommand().parseAsync(['node', 'zhin', ...args]); }
const sourceReply = { source: '{}', revision: sourceRevision, format: 'json', configKeys: [] };
/** A Host that answers the pre-mutation read and then replies to the single write with `write(request)`. */
function rawHost(write: (request: Record<string, unknown>) => Response) {
  const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body));
    return request.type === 'config:get-source' ? new Response(JSON.stringify({ data: sourceReply, requestId: request.requestId })) : write(request);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const last = (output: ReturnType<typeof vi.spyOn>) => JSON.parse(String(output.mock.calls.at(-1)?.[0]));

it('set defaults to this project\'s gateway over its local socket and never writes the local file', async () => {
  const { file, source } = await fixture();
  const fetch = fakeHost();
  await run('set', 'log_level', 'debug');
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[0]![0])).toBe('http://127.0.0.1:18086/api/console/request');
  // The local owner needs no token: neither http.token nor the bootstrap token is sent.
  expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('authorization');
  expect(body(fetch, 1)).toMatchObject({ type: 'config:patch-project', expectedRevision: sourceRevision,
    patches: [{ op: 'set', path: ['log_level'], value: 'debug' }] });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
});

it('without this project\'s gateway it refuses instead of calling the configured port (#1250)', async () => {
  // Another project's gateway may listen on 127.0.0.1:18086: no request, no token may go there.
  const { file, source, output } = await fixture();
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'env-token');
  vi.stubEnv('HTTP_TOKEN', 'bootstrap-token');
  gateway.running = false;
  const fetch = fakeHost();
  for (const args of [['get', 'log_level'], ['set', 'log_level', 'debug'], ['unset', 'log_level'], ['list']]) {
    await run(...args);
    expect(last(output), args.join(' ')).toMatchObject({ status: 'not-connected', message: expect.stringContaining('本项目的网关未运行') });
    expect(last(output).message).toContain('--offline');
    expect(process.exitCode).toBe(CONFIG_EXIT_CODES.notConnected);
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('refuses an explicit loopback --host that serves another project, before sending the token (#1250)', async () => {
  const { root, output } = await fixture();
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'env-token');
  gateway.running = false;
  const requests: { url: string; init?: RequestInit }[] = [];
  const otherProject = projectIdentity(join(root, '..', 'another-project'));
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/pub/health')) return new Response(JSON.stringify({ success: true, status: 'ok', project: { id: otherProject } }));
    return new Response(JSON.stringify({ data: sourceReply }));
  }));
  await run('set', 'log_level', 'debug', '--host', 'http://127.0.0.1:8068');
  expect(last(output)).toMatchObject({ status: 'project-mismatch', message: expect.stringContaining('另一个项目') });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
  expect(requests.map(request => request.url)).toEqual(['http://127.0.0.1:8068/pub/health']);
  expect(requests[0]!.init?.headers).toBeUndefined();
});

it('refuses an explicit loopback --host that reports no project id, before sending the token (#1250)', async () => {
  const { file, source, output } = await fixture();
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'env-token');
  gateway.running = false;
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/pub/health')) return new Response(JSON.stringify({ success: true, status: 'ok' }));
    return new Response(JSON.stringify({ data: sourceReply }));
  }));
  await run('set', 'log_level', 'debug', '--host', 'http://127.0.0.1:8068');
  expect(last(output)).toMatchObject({ status: 'project-unverified', message: expect.stringContaining('--allow-unverified-host') });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
  expect(requests.map(request => request.url)).toEqual(['http://127.0.0.1:8068/pub/health']);
  expect(requests[0]!.init?.headers).toBeUndefined();
  expect(JSON.stringify(requests)).not.toContain('env-token');
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('--allow-unverified-host warns and proceeds against a loopback --host without project id', async () => {
  const { errors } = await fixture();
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'env-token');
  gateway.running = false;
  const urls: string[] = [];
  const authorization: (string | null)[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, options?: RequestInit) => {
    urls.push(String(url));
    if (String(url).endsWith('/pub/health')) return new Response(JSON.stringify({ success: true, status: 'ok' }));
    authorization.push(new Headers(options?.headers).get('authorization'));
    const request = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ data: request.type === 'config:get-source' ? sourceReply : saved() }));
  }));
  await run('set', 'log_level', 'debug', '--host', 'http://127.0.0.1:8068', '--allow-unverified-host');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
  expect(urls).toEqual(['http://127.0.0.1:8068/pub/health', 'http://127.0.0.1:8068/api/console/request', 'http://127.0.0.1:8068/api/console/request']);
  expect(authorization).toEqual(['Bearer env-token', 'Bearer env-token']);
  expect(errors).toHaveBeenCalledWith(expect.stringContaining('没有报告项目标识'));
});

it('accepts an explicit loopback --host that reports this project', async () => {
  const { root } = await fixture();
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'env-token');
  gateway.running = false;
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, options?: RequestInit) => {
    urls.push(String(url));
    if (String(url).endsWith('/pub/health')) return new Response(JSON.stringify({ project: { id: projectIdentity(root) } }));
    const request = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ data: request.type === 'config:get-source' ? sourceReply : saved() }));
  }));
  await run('set', 'log_level', 'debug', '--host', 'http://127.0.0.1:8068');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
  expect(urls).toEqual(['http://127.0.0.1:8068/pub/health', 'http://127.0.0.1:8068/api/console/request', 'http://127.0.0.1:8068/api/console/request']);
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

it.each([401, 403])('an HTTP %i is an authentication failure (exit 1), distinct from unknown and never falls back', async status => {
  const { file, source, output } = await fixture();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { calls++; return new Response('{"error":"Unauthorized"}', { status }); }));
  await run('set', 'log_level', 'debug');
  expect(calls).toBe(1);
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(last(output)).toMatchObject({ status: 'unauthorized', httpStatus: status });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
});

it('an authoritative Host rejection (HTTP 400 echoing this requestId) of the mutation is exit 1, not unknown', async () => {
  const { output } = await fixture();
  const fetch = rawHost(request => new Response(JSON.stringify({ success: false, error: 'Full scope required', requestId: request.requestId }), { status: 400 }));
  await run('set', 'log_level', 'debug');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(last(output)).toMatchObject({ status: 'rejected', expectedRevision: sourceRevision, message: expect.stringContaining('Full scope required') });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
});

it.each([
  ['proxy 502 with an error string', () => new Response('{"error":"Bad Gateway"}', { status: 502 })],
  ['proxy 504 with an empty object', () => new Response('{}', { status: 504 })],
  ['route-level 500 with an error string', () => new Response('{"success":false,"error":"No response"}', { status: 500 })],
  ['400 without a requestId', () => new Response('{"success":false,"error":"Bad request"}', { status: 400 })],
  ['400 with another requestId', () => new Response('{"success":false,"error":"Bad request","requestId":"other"}', { status: 400 })],
  ['200 carrying an error string', () => new Response('{"error":"odd"}', { status: 200 })],
  ['409 with an error string', () => new Response('{"error":"Conflict"}', { status: 409 })],
] as const)('after the write was dispatched, %s is unknown (exit 6): one write, no offline fallback', async (_name, reply) => {
  const { file, source, output } = await fixture();
  const fetch = rawHost(reply);
  await run('set', 'log_level', 'debug');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.filter(call => body(fetch, fetch.mock.calls.indexOf(call)).type === 'config:patch-project')).toHaveLength(1);
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(last(output)).toMatchObject({ status: 'unknown', expectedRevision: sourceRevision, requestId: body(fetch, 1).requestId });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.unknown);
});

it.each([
  ['application unconfirmed', saved({ applicationError: 'unconfirmed' })],
  ['group unknown', saved({ application: receipt([{ status: 'applied' }, { status: 'unknown' }]) })],
  ['server unconfirmed', { status: 'unconfirmed', expectedRevision: sourceRevision, message: 'unconfirmed' }],
] as const)('every exit-6 receipt (%s) carries requestId and expectedRevision', async (_name, data) => {
  const { output } = await fixture();
  const fetch = fakeHost(() => data);
  await run('set', 'log_level', 'debug');
  expect(last(output)).toMatchObject({ status: data.status, requestId: body(fetch, 1).requestId, expectedRevision: sourceRevision });
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.unknown);
});

it('human mode prints exit-6 evidence (requestId, expectedRevision) and no JSON', async () => {
  const { output, errors } = await fixture();
  const fetch = rawHost(() => new Response('{"error":"Bad Gateway"}', { status: 502 }));
  await runHuman('set', 'log_level', 'debug');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.unknown);
  const stderr = errors.mock.calls.map(call => String(call[0])).join('\n');
  expect(stderr).toContain(`requestId=${body(fetch, 1).requestId}`);
  expect(stderr).toContain(`expectedRevision=${sourceRevision}`);
  expect(output).not.toHaveBeenCalled();
});

it('human mode prints evidence for a saved-but-unconfirmed receipt and only the human line on stdout', async () => {
  const { output, errors } = await fixture();
  const fetch = fakeHost(() => saved({ application: receipt([{ status: 'unknown' }]) }));
  await runHuman('set', 'log_level', 'debug');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.unknown);
  expect(output.mock.calls.map(call => String(call[0]))).toEqual([expect.stringContaining('生效结果未知')]);
  expect(String(errors.mock.calls.at(-1)?.[0])).toBe(`requestId=${body(fetch, 1).requestId} expectedRevision=${sourceRevision}`);
});

it('human mode shows the latest (masked) values of a conflict instead of a JSON dump', async () => {
  const { output } = await fixture();
  fakeHost(() => ({ status: 'conflict', revision: savedRevision, current: [{ path: ['log_level'], value: 'warn' }], message: 'conflict' }));
  await runHuman('set', 'log_level', 'debug');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.conflict);
  expect(output.mock.calls.map(call => String(call[0]))).toEqual(['conflict（版本冲突，未保存）\n  log_level: "warn"']);
});

it.each([['0.0.0.0', 'http://127.0.0.1:18086/api/console/request'], ['::', 'http://[::1]:18086/api/console/request']])(
  'a wildcard bind address %s derives the loopback URL of the local-socket request, without the file token', async (bind, url) => {
    await fixture({ configVersion: 2, plugins: {}, http: { host: bind, port: 18086, token: 'file-token' } });
    const fetch = fakeHost();
    await run('set', 'log_level', 'debug');
    expect(String(fetch.mock.calls[0]![0])).toBe(url);
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('authorization');
    expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
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

it.each([
  ['an invalid --offline --environment', ['--offline', '--environment', 'Bad/Name']],
  ['an invalid --token-env', ['--token-env', 'not-a-name!']],
  ['an unset --token-env', ['--token-env', 'CLI_TEST_UNSET_TOKEN']],
] as const)('%s is a structured usage error (exit 1) without any request', async (_name, flags) => {
  const { file, source, output } = await fixture();
  const fetch = fakeHost();
  await run('set', 'log_level', 'debug', ...flags);
  expect(fetch).not.toHaveBeenCalled();
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(last(output).status).toBe('usage');
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

it('sends HTTP_TOKEN to an explicit --host when ZHIN_CONSOLE_TOKEN is unset', async () => {
  const prevConsole = process.env.ZHIN_CONSOLE_TOKEN;
  const prevHttp = process.env.HTTP_TOKEN;
  delete process.env.ZHIN_CONSOLE_TOKEN;
  process.env.HTTP_TOKEN = 'env-http-token';
  try {
    await fixture({ configVersion: 2, plugins: {}, http: { host: '127.0.0.1', port: 18086 } });
    const fetch = fakeHost();
    await run('set', 'log_level', 'debug', '--host', 'https://remote.test');
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ authorization: 'Bearer env-http-token' });
    expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
  } finally {
    if (prevConsole === undefined) delete process.env.ZHIN_CONSOLE_TOKEN;
    else process.env.ZHIN_CONSOLE_TOKEN = prevConsole;
    if (prevHttp === undefined) delete process.env.HTTP_TOKEN;
    else process.env.HTTP_TOKEN = prevHttp;
  }
});

it('an unknown key says there is no such setting and suggests close ones, without RPC names (#1250)', async () => {
  const { output } = await fixture({ configVersion: 2, plugins: {}, log_level: 'info', http: { port: 18086 } });
  await runHuman('set', 'htp.port', '1', '--offline');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.invalid);
  const text = output.mock.calls.map(call => String(call[0])).join('\n');
  expect(text).toContain('没有这个配置项，未保存');
  expect(text).toContain('htp: 没有这个配置项：htp');
  expect(text).toContain('你是不是想写：http');
  expect(text).not.toContain('gateway.plugins.declare');
});

it('an array index past the end explains how to append, in Chinese (#1250)', async () => {
  const { output } = await fixture({ configVersion: 2, plugins: {}, http: { port: 18086, corsOrigins: ['https://a.example'] } });
  await runHuman('set', 'http.corsOrigins.3', '"https://b.example"', '--offline');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.invalid);
  const text = output.mock.calls.map(call => String(call[0])).join('\n');
  expect(text).toContain('http.corsOrigins.3 超出数组范围（当前有 1 项，下标 0–0）');
  expect(text).toContain("zhin config set http.corsOrigins '<JSON 数组>'");
  expect(text).not.toMatch(/out of bounds|Config path/);
});

it('a rejected request shows the revision evidence only with --debug (#1250)', async () => {
  const { errors } = await fixture();
  rawHost(request => new Response(JSON.stringify({ error: '插件声明不能修改', requestId: request.requestId }), { status: 400 }));
  await runHuman('set', 'log_level', 'debug');
  const stderr = () => errors.mock.calls.map(call => String(call[0])).join('\n');
  expect(stderr()).toContain('Host 拒绝请求：插件声明不能修改');
  expect(stderr()).not.toContain('expectedRevision=');
  errors.mockClear();
  vi.stubEnv('ZHIN_CLI_DEBUG', '1');
  rawHost(request => new Response(JSON.stringify({ error: '插件声明不能修改', requestId: request.requestId }), { status: 400 }));
  await runHuman('set', 'log_level', 'debug');
  expect(stderr()).toContain(`expectedRevision=${sourceRevision}`);
});

it('a broken http.port gives an offline repair hint instead of Invalid URL (#1250)', async () => {
  const { errors } = await fixture({ configVersion: 2, plugins: {}, http: { port: 'abc' } });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await runHuman('get', 'http');
  expect(fetch).not.toHaveBeenCalled();
  const stderr = errors.mock.calls.map(call => String(call[0])).join('\n');
  expect(stderr).toContain('http.port 无效');
  expect(stderr).toContain('zhin config set http.port 8068 --offline');
  expect(stderr).not.toContain('Invalid URL');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.error);
});

it('config set of a secret writes the value to .env and keeps the ${VAR} reference, never echoing it (#1250)', async () => {
  const { root, output, errors } = await fixture({ configVersion: 2, plugins: {}, http: { port: 18086, token: '${HTTP_TOKEN}' } });
  await writeFile(join(root, '.env'), 'HTTP_TOKEN=old\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', zhin: { protocol: 1, type: 'plugin' } }));
  await runHuman('set', 'http.token', 'super-secret-value', '--offline');
  expect(process.exitCode).toBe(CONFIG_EXIT_CODES.ok);
  expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')).http.token).toBe('${HTTP_TOKEN}');
  expect(await readFile(join(root, '.env'), 'utf8')).toBe("HTTP_TOKEN='super-secret-value'\n");
  const printed = [...output.mock.calls, ...errors.mock.calls].map(call => String(call[0])).join('\n');
  expect(printed).toContain('敏感字段 http.token 的值已写入 .env 的 HTTP_TOKEN，配置中保留 ${HTTP_TOKEN} 引用');
  expect(printed).not.toContain('super-secret-value');
});

it('config set --plain writes the literal and warns (#1250)', async () => {
  const { root, errors } = await fixture({ configVersion: 2, plugins: {}, http: { port: 18086, token: '${HTTP_TOKEN}' } });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', zhin: { protocol: 1, type: 'plugin' } }));
  await runHuman('set', 'http.token', 'plain-on-purpose', '--offline', '--plain');
  expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')).http.token).toBe('plain-on-purpose');
  expect(errors.mock.calls.map(call => String(call[0])).join('\n')).toContain('警告：--plain 会把敏感字段的值以明文写进配置文件');
});

it('config set sends secretStorage plain to the Host only with --plain (#1250)', async () => {
  await fixture();
  const fetch = fakeHost();
  await run('set', 'http.token', 'x');
  expect(body(fetch, 1)).not.toHaveProperty('secretStorage');
  const again = fakeHost();
  await run('set', 'http.token', 'x', '--plain');
  expect(body(again, 1)).toMatchObject({ secretStorage: 'plain' });
});
