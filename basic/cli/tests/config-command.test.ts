import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createConfigCommand } from '../src/commands/config.js';
import { ConfigFileDocument } from '@zhin.js/config-file';

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
async function fixture(document: Record<string, unknown> = { configVersion: 2, plugins: {}, log_level: 'info' }) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-command-'));
  roots.push(root);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const file = join(root, 'zhin.config.json');
  const source = JSON.stringify(document);
  await writeFile(file, source);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'config-fixture', version: '1.0.0', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.mjs', platformFeatures: false } }));
  await writeFile(join(root, 'plugin.mjs'), 'export default { setup() { throw new Error("setup must not run"); } };');
  return { root, file, source, output };
}
function fakeHost(source: string, mutate: (request: Record<string, unknown>) => unknown = () => ({ status: 'saved', revision: 'b'.repeat(64), restartRequired: false, message: '配置已保存', paths: [['log_level']], missingEnv: [] })) {
  const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body));
    let data: unknown;
    if (request.type === 'config:get-source') data = { source, revision: sourceRevision, format: 'json', configKeys: [] };
    else if (request.type === 'config:get-all') data = JSON.parse(source);
    else if (request.type === 'schema:get') data = { type: 'object', object: {} };
    else data = await mutate(request);
    return new Response(JSON.stringify({ data }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function run(...args: string[]) { await createConfigCommand().parseAsync(['node', 'zhin', '--json', ...args]); }

it('config set defaults to the running Host and never silently writes the local file', async () => {
  const { file, source } = await fixture();
  const fetch = fakeHost(source);
  await run('set', 'log_level', 'debug');
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toMatchObject({ type: 'config:patch-project', expectedRevision: sourceRevision,
    patches: [{ op: 'set', path: ['log_level'], value: 'debug' }] });
});

it('uses explicit Host/token options and shared JSON Pointer paths without changing JSON value semantics', async () => {
  const { source } = await fixture();
  vi.stubEnv('CLI_TEST_TOKEN', 'synthetic-console-token');
  const fetch = fakeHost(source);
  await run('set', '/plugin/key.with.dot/0/a~1b~0c', '{"enabled":true}', '--live', 'https://host.test/custom', '--token-env', 'CLI_TEST_TOKEN');
  expect(fetch.mock.calls[1]![0]).toBeInstanceOf(URL);
  expect(String(fetch.mock.calls[1]![0])).toBe('https://host.test/custom/console/request');
  expect(fetch.mock.calls[1]![1]?.headers).toMatchObject({ authorization: 'Bearer synthetic-console-token' });
  expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body)).patches).toEqual([{ op: 'set', path: ['plugin', 'key.with.dot', '0', 'a/b~c'], value: { enabled: true } }]);
});

it('read failures never fall back to local writes', async () => {
  const { file, source } = await fixture();
  const fetch = vi.fn(async () => { throw new Error('synthetic connection refused'); });
  vi.stubGlobal('fetch', fetch);
  await expect(run('set', 'log_level', 'debug')).rejects.toThrow(/unconfirmed/);
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('a response lost after a mutation is unconfirmed, has evidence, and is never retried or rolled back', async () => {
  const { file, source, output } = await fixture();
  let committed = false;
  const fetch = fakeHost(source, () => { committed = true; throw new Error('lost reply containing synthetic-sensitive-detail'); });
  await run('delete', 'plugin.rows.0');
  expect(committed).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await readFile(file, 'utf8')).toBe(source);
  const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
  expect(result).toMatchObject({ status: 'unconfirmed', expectedRevision: sourceRevision, requestId: expect.any(String) });
  expect(result.requestId).toBe(JSON.parse(String(fetch.mock.calls[1]![1]?.body)).requestId);
  expect(JSON.stringify(result)).not.toContain('synthetic-sensitive-detail');
  expect(process.exitCode).toBe(1);
});

it('keeps server-side commit uncertainty and the exact request evidence through the CLI', async () => {
  const { source, output } = await fixture();
  const fetch = fakeHost(source, () => ({ status: 'unconfirmed', expectedRevision: sourceRevision, message: 'storage outcome unconfirmed' }));
  await run('set', 'log_level', 'debug', '--json');
  const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
  expect(result).toMatchObject({ status: 'unconfirmed', expectedRevision: sourceRevision,
    requestId: JSON.parse(String(fetch.mock.calls[1]![1]?.body)).requestId });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(process.exitCode).toBe(1);
});

it('adds exact request evidence to a known unconfirmed apply response', async () => {
  const { source, output } = await fixture();
  const fetch = fakeHost(source, () => ({ status: 'unconfirmed', message: 'application outcome unconfirmed' }));
  await run('apply');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ status: 'unconfirmed', expectedRevision: sourceRevision,
    requestId: JSON.parse(String(fetch.mock.calls[1]![1]?.body)).requestId });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(process.exitCode).toBe(1);
});

it.each([null, {}, { status: 'invented' }, { status: 'saved', revision: 'not-a-revision' },
  { status: 'saved', revision: 'b'.repeat(64), restartRequired: false, paths: [], missingEnv: [], message: 'saved',
    application: { operationId: 'op', sourceRevision: 'b'.repeat(64), saved: true, generation: 1, applicationRevision: 0, groups: [null] } },
  { status: 'applied', application: { operationId: 'op', sourceRevision, saved: false, generation: 0, applicationRevision: 0, groups: [] } },
  { status: 'applied', application: { operationId: 'op', sourceRevision: 'b'.repeat(64), saved: true, generation: 1, applicationRevision: 0, groups: [] } },
  { status: 'unconfirmed', expectedRevision: 'b'.repeat(64), message: 'wrong request evidence' },
])('retains unknown evidence when a mutation response is malformed: %j', async data => {
  const { source, output } = await fixture();
  const fetch = fakeHost(source, () => data);
  await run(data?.status === 'applied' ? 'apply' : 'set', ...(data?.status === 'applied' ? [] : ['log_level', 'debug']));
  const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
  expect(result).toMatchObject({ status: 'unconfirmed', expectedRevision: sourceRevision,
    requestId: JSON.parse(String(fetch.mock.calls[1]![1]?.body)).requestId });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(process.exitCode).toBe(1);
});

it.each(['conflict', 'invalid'] as const)('retains known %s results instead of calling them applied or unknown', async status => {
  const { source, output } = await fixture();
  fakeHost(source, () => ({ status, revision: 'b'.repeat(64), message: status,
    ...(status === 'conflict' ? { current: [{ path: ['log_level'], value: 'info' }] } : { errors: [{ path: '$.log_level', message: 'invalid' }], missingEnv: [] }) }));
  await run('set', 'log_level', 'debug');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).status).toBe(status);
  expect(process.exitCode).toBe(1);
});

it('keeps an explicit Host permission rejection distinct from an unknown network result', async () => {
  const { file, source, output } = await fixture();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ++calls === 1
    ? new Response(JSON.stringify({ data: { source, revision: sourceRevision, format: 'json', configKeys: [] } }))
    : new Response(JSON.stringify({ error: 'Full scope required' }), { status: 403 })));
  await expect(run('set', 'log_level', 'debug')).rejects.toThrow('Full scope required');
  expect(calls).toBe(2);
  expect(await readFile(file, 'utf8')).toBe(source);
  expect(output.mock.calls.flat().join('')).not.toContain('unconfirmed');
});

it('reports partial pending/failed/unknown application groups without claiming complete application', async () => {
  const { source, output } = await fixture();
  const groups = [{ id: 'http', paths: [['http']], effect: 'restart-process', status: 'restart-pending', dependsOn: [] },
    { id: 'models', paths: [['ai']], effect: 'replace-resource', status: 'unknown', dependsOn: [] }];
  fakeHost(source, () => ({ status: 'saved', revision: 'b'.repeat(64), restartRequired: true,
    message: '配置已保存，请查看各项生效结果', paths: [['log_level']], missingEnv: [],
    application: { operationId: 'op', sourceRevision: 'b'.repeat(64), saved: true, generation: 2, applicationRevision: 1, groups } }));
  await run('set', 'log_level', 'debug');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ status: 'saved', restartRequired: true, application: { groups } });
  expect(process.exitCode).toBe(1);
});

it('supports live get/list, schema projection, source-free status and exact-revision apply', async () => {
  const { source, output } = await fixture({ configVersion: 2, plugins: {}, plugin: { 'dot.key': [true, false] } });
  const fetch = fakeHost(source, () => ({ status: 'applied', application: { operationId: 'applied-op', sourceRevision,
    saved: true, generation: 1, applicationRevision: 0, groups: [] } }));
  await run('get', '/plugin/dot.key/1');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toBe(false);
  await run('ls');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ plugin: { 'dot.key': [true, false] } });
  await run('get', 'configVersion');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toBe(2);
  await run('get', 'plugins');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({});
  await run('schema', 'ai');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ projection: 'console-form', schema: { type: 'object' } });
  await run('status');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({ revision: sourceRevision, format: 'json', configKeys: [] });
  const calls = fetch.mock.calls.length;
  await run('apply', '--expected-revision', sourceRevision);
  expect(fetch.mock.calls.length - calls).toBe(1);
  expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ type: 'config:apply', expectedRevision: sourceRevision });
});

it('requires explicit offline for local mutation and rejects offline apply or ambiguous targets', async () => {
  const { file, output } = await fixture();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await run('set', 'log_level', 'debug', '--offline');
  expect(JSON.parse(await readFile(file, 'utf8')).log_level).toBe('debug');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ status: 'saved', application: 'not-requested' });
  await expect(run('apply', '--offline')).rejects.toThrow(/Host/);
  await expect(run('set', 'log_level', 'info', '--offline', '--live', 'http://localhost:9999')).rejects.toThrow(/同时/);
  expect(fetch).not.toHaveBeenCalled();
});

it('reports uncertain offline commits with the original revision and exits unsuccessfully without reverting disk', async () => {
  const { file, output } = await fixture();
  const prepare = ConfigFileDocument.prototype.prepare;
  let expectedRevision: string | undefined;
  const commit = vi.fn();
  const rollback = vi.fn();
  vi.spyOn(ConfigFileDocument.prototype, 'prepare').mockImplementation(async function (current, patches) {
    expectedRevision = current.revision;
    const prepared = await prepare.call(this, current, patches);
    commit.mockImplementation(async () => { await prepared.commit(); throw new Error('synthetic acknowledgement lost'); });
    return { document: prepared.document, pluginOrder: prepared.pluginOrder, commit, rollback };
  });
  await run('set', 'log_level', 'debug', '--offline');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ status: 'unconfirmed', expectedRevision, application: 'not-requested' });
  expect(JSON.parse(await readFile(file, 'utf8')).log_level).toBe('debug');
  expect(commit).toHaveBeenCalledTimes(1);
  expect(rollback).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('does not allow check --fix to bypass the Host by implicitly writing local configuration', async () => {
  const { file, source } = await fixture();
  await expect(run('check', '--fix')).rejects.toThrow(/--offline/);
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('check --fix --offline validates the complete candidate before saving a migration', async () => {
  const { root, file, source } = await fixture({ configVersion: 2, plugins: {}, log_level: 'INFO', plugin: { count: 0 } });
  await writeFile(join(root, 'plugin.mjs'), 'export default { config: { toJsonSchema() { return {type:"object",properties:{count:{type:"number",minimum:1}}}; } } };');
  await expect(run('check', '--fix', '--offline')).rejects.toThrow(/minimum|>= 1/);
  expect(await readFile(file, 'utf8')).toBe(source);
});

it('check --fix preserves an offline committed migration when its acknowledgement is lost', async () => {
  const { file, output } = await fixture({ configVersion: 2, plugins: {}, log_level: 'INFO' });
  const prepare = ConfigFileDocument.prototype.prepare;
  let expectedRevision: string | undefined;
  const commit = vi.fn();
  const rollback = vi.fn();
  vi.spyOn(ConfigFileDocument.prototype, 'prepare').mockImplementation(async function (current, patches) {
    expectedRevision = current.revision;
    const prepared = await prepare.call(this, current, patches);
    commit.mockImplementation(async () => { await prepared.commit(); throw new Error('synthetic acknowledgement lost'); });
    return { document: prepared.document, pluginOrder: prepared.pluginOrder, commit, rollback };
  });
  await run('check', '--fix', '--offline');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ status: 'unconfirmed', expectedRevision, application: 'not-requested' });
  expect(JSON.parse(await readFile(file, 'utf8')).log_level).toBe('info');
  expect(commit).toHaveBeenCalledTimes(1);
  expect(rollback).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('never sends malformed or empty paths to the Host', async () => {
  await fixture();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(run('set', '', 'value')).rejects.toThrow();
  await expect(run('set', 'plugin.__proto__.x', 'value')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
