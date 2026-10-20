import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RootRuntime, NodePackageResolver, primaryConfigToken, type ModuleRuntime } from '@zhin.js/runtime';
import { definePlugin, rootPluginId, childPluginId } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/config-file';
import { dispatchRuntimeConsoleRpc, pickRpcReply, createHttpHost, readJsonBody } from '@zhin.js/host-http';
import { CONFIG_RPC, DEMO_RPC_ALLOWLIST, type ConsoleConfigExplanation } from '@zhin.js/console-protocol';
import { PluginManagementWorkflow } from '../src/plugin-management/workflow.js';

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0).reverse()) { await f.runtime.stop(); await rm(f.root, { recursive: true, force: true }); } });
const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false };
async function fixture(schema: Record<string, unknown>, input: unknown = {}, custom = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-config-explain-'))), pkg = join(root, 'node_modules/example');
  await mkdir(pkg, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'test-root', version: '1.0.0', dependencies: { example: '1.0.0' }, zhin: manifest }));
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', zhin: manifest }));
  await writeFile(join(root, 'plugin.js'), 'export default {};'); await writeFile(join(pkg, 'plugin.js'), 'export default {};');
  const file = join(root, 'zhin.config.json'), source = { configVersion: 2, plugins: { demo: 'example' }, demo: input };
  await writeFile(file, JSON.stringify(source));
  const definitions = new Map([[join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
    [join(pkg, 'plugin.js'), { default: definePlugin({ name: 'example', config: { toJsonSchema: () => schema } }) }]]);
  const load = vi.fn(async <T>(path: string) => definitions.get(path) as T);
  const modules: ModuleRuntime = { load, async close() {} };
  const resolver = Object.assign((node: { parent?: unknown }) => node.parent ? { count: 5 } : {}, { schema: (node: { parent?: unknown }) => node.parent ? schema : { type: 'object', properties: {} }, compositionMode: 'document' as const });
  const runtime = new RootRuntime({ projectRoot: root, modules, config: custom ? resolver : createConfigDocument(file), ...(custom ? { application: source } : {}),
    environment: { name: 'test', mode: 'test', platform: 'node' }, environmentVariables: { base: { API_KEY: 'ROOT_SECRET_SENTINEL' }, plugins: { 'root/demo': { API_KEY: 'CHILD_SECRET_SENTINEL' } } } });
  await runtime.start(); load.mockClear();
  const document = createConfigDocument(file), workflow = new PluginManagementWorkflow(root, { snapshots: runtime.snapshots });
  const f = { root, pkg, file, runtime, load, document, workflow, explain: async () => workflow.explainConfiguration('demo', (await document.read()).revision),
    save: async (value: unknown) => writeFile(file, JSON.stringify({ ...source, demo: value })) };
  fixtures.push(f); return f;
}
const simple = { type: 'object', properties: { count: { type: 'integer', default: 5 }, optional: { type: 'string' }, nested: { type: 'object', default: {}, properties: { enabled: { type: 'boolean', default: true } } }, 'literal.dot': { type: 'string' } } };
function field(result: ConsoleConfigExplanation, ...path: string[]) { const found = result.fields.find(item => JSON.stringify(item.path) === JSON.stringify(path)); expect(found).toBeDefined(); return found!; }
function pauseResolution() {
  let resolve!: () => void, release!: () => void;
  const entered = new Promise<void>(done => { resolve = done; }), wait = new Promise<void>(done => { release = done; });
  const original = NodePackageResolver.prototype.resolve;
  const spy = vi.spyOn(NodePackageResolver.prototype, 'resolve').mockImplementationOnce(async function (...args) { resolve(); await wait; return original.apply(this, args); });
  return { entered, release, spy };
}

describe('metadata-only config explanations through the actual Runtime and file authority', () => {
  it('distinguishes current candidate defaults and explicit file values without claiming historical generation origins or mutating the file', async () => {
    const f = await fixture(simple), before = await readFile(f.file, 'utf8');
    const first = await f.explain();
    expect(field(first, 'count')).toMatchObject({ candidateOrigin: 'schema-default', generationMatch: 'equal', generationOrigin: 'unknown' });
    expect(field(first, 'optional')).toMatchObject({ candidateOrigin: 'unset', generationMatch: 'equal' });
    expect(field(first, 'nested', 'enabled')).toMatchObject({ candidateOrigin: 'schema-default', generationMatch: 'equal' });
    expect(await readFile(f.file, 'utf8')).toBe(before); expect(f.load).not.toHaveBeenCalled();
    await f.save({ count: 5, 'literal.dot': 'VISIBLE_ONLY_IN_FILE' });
    const second = await f.explain();
    expect(second.generation).toBe(first.generation); expect(second.revision).not.toBe(first.revision);
    expect(field(second, 'count')).toMatchObject({ candidateOrigin: 'file', generationMatch: 'equal', generationOrigin: 'unknown' });
    expect(field(second, 'literal.dot')).toMatchObject({ path: ['literal.dot'], generationMatch: 'different' });
    expect(JSON.stringify(second)).not.toContain('VISIBLE_ONLY_IN_FILE');
    await f.save({ count: 6 }); expect(field(await f.explain(), 'count').generationMatch).toBe('different');
  });

  it('uses the owner generation rather than Root expansion and never emits environment names, references, defaults or sensitive descendant values', async () => {
    const schema = { type: 'object', properties: { environment: { type: 'string' }, fallback: { type: 'string', default: '${MISSING_REFERENCE:-FALLBACK_SECRET}' },
      password: { type: 'string', writeOnly: true, default: 'THIRD_PARTY_SECRET_DEFAULT' }, group: { type: 'object', 'x-zhin-config': { secret: true }, properties: { child: { type: 'string', 'x-zhin-config': { secret: false } } } } } };
    const f = await fixture(schema, { environment: '${API_KEY}', group: { child: 'NESTED_SECRET' } });
    const primary = f.runtime.snapshot.resources.get(rootPluginId())!.get(primaryConfigToken.id) as { expanded: Record<string, { environment: string }> };
    expect(primary.expanded.demo.environment).toBe('ROOT_SECRET_SENTINEL');
    expect(f.runtime.snapshot.config.get(childPluginId(rootPluginId(), 'demo'))).toMatchObject({ environment: 'CHILD_SECRET_SENTINEL' });
    const result = await f.explain();
    for (const path of [['environment'], ['fallback'], ['password'], ['group', 'child']]) expect(field(result, ...path).generationMatch).toBe('redacted');
    const serialized = JSON.stringify(result);
    for (const marker of ['API_KEY', 'MISSING_REFERENCE', '${', 'SECRET', 'THIRD_PARTY', 'NESTED']) expect(serialized).not.toContain(marker);
    // The old generation's reference remains hidden even after the saved candidate becomes literal.
    await f.save({ environment: 'CHILD_SECRET_SENTINEL', group: { child: 'changed' } });
    expect(field(await f.explain(), 'environment').generationMatch).toBe('redacted');
  });

  it.each([
    { type: 'object', properties: { list: { type: 'array', items: { type: 'string' } } } },
    { type: 'object', properties: { nested: { type: 'object', additionalProperties: { type: 'string' } } } },
    { type: 'object', properties: { scalar: { anyOf: [{ type: 'string' }, { type: 'number' }] } } },
  ])('does not partially explain complex schemas', async schema => {
    const f = await fixture(schema); expect(await f.explain()).toMatchObject({ projection: 'unsupported', reason: 'complex-schema', fields: [] });
  });

  it('explains a fixed string-literal choice field (the same union the Console form edits) as a scalar', async () => {
    const tone = { anyOf: [{ const: 'calm', default: 'calm' }, { const: 'excited', default: 'excited' }], default: 'calm' };
    const f = await fixture({ type: 'object', additionalProperties: false, properties: { tone, count: { type: 'integer', default: 5 } } });
    const first = await f.explain();
    expect(first.projection).toBe('supported');
    expect(field(first, 'tone')).toMatchObject({ candidateOrigin: 'schema-default', generationMatch: 'equal', generationOrigin: 'unknown' });
    await f.save({ tone: 'excited' });
    const saved = await f.explain();
    expect(field(saved, 'tone')).toMatchObject({ candidateOrigin: 'file', generationMatch: 'different' });
    expect(JSON.stringify(saved)).not.toContain('excited');
  });

  it('does not trust a custom resolver claiming standard mode, and marks unavailable owners and package/schema drift explicitly', async () => {
    const custom = await fixture(simple, {}, true);
    expect(await custom.explain()).toMatchObject({ projection: 'unsupported', reason: 'custom-resolver', fields: [] });
    const f = await fixture(simple);
    expect(await f.workflow.explainConfiguration('missing', (await f.document.read()).revision)).toMatchObject({ projection: 'unsupported', reason: 'instance-unavailable' });
    const path = join(f.pkg, 'package.json'), pkg = JSON.parse(await readFile(path, 'utf8')); await writeFile(path, JSON.stringify({ ...pkg, version: '2.0.0' }));
    expect(await f.explain()).toMatchObject({ projection: 'unsupported', reason: 'schema-drift', fields: [] });
  });

  it('marks an invalid saved candidate unsupported without echoing its content or validator details', async () => {
    const f = await fixture(simple); await f.save({ count: 'PRIVATE_INVALID_SENTINEL' });
    const result = await f.explain(); expect(result).toMatchObject({ projection: 'unsupported', reason: 'candidate-invalid', fields: [] });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INVALID_SENTINEL');
  });

  it('bounds static field count and refuses a whole oversized projection rather than dropping fields', async () => {
    const f = await fixture({ type: 'object', properties: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`field${index}`, { type: 'string' }])) });
    expect(await f.explain()).toMatchObject({ projection: 'unsupported', reason: 'bound-exceeded', fields: [] });
  });

  it.each(['file', 'project', 'generation'] as const)('rejects %s drift during the same leased observation', async kind => {
    const f = await fixture(simple), revision = (await f.document.read()).revision, pause = pauseResolution();
    const operation = f.workflow.explainConfiguration('demo', revision);
    const observed = operation.catch(error => error);
    let reloaded: Promise<unknown> | undefined;
    try {
      await pause.entered;
      if (kind === 'file') await f.save({ count: 8 });
      else if (kind === 'project') { const path = join(f.root, 'package.json'); const pkg = JSON.parse(await readFile(path, 'utf8')); await writeFile(path, JSON.stringify({ ...pkg, version: '1.0.1' })); }
      else { const previous = f.runtime.snapshot.generation; reloaded = f.runtime.reload(childPluginId(rootPluginId(), 'demo')); await vi.waitFor(() => expect(f.runtime.snapshot.generation).toBeGreaterThan(previous)); }
      pause.release(); expect(await observed).toBeInstanceOf(Error); expect(String(await observed)).toContain('重新读取文件版本'); await reloaded;
      if (kind === 'generation') expect((await f.explain()).projection).toBe('supported');
    } finally { pause.release(); pause.spy.mockRestore(); await reloaded; }
  });

  it('keeps the composition marker with actual committed config patches and preserves it on rejected candidates', async () => {
    const f = await fixture(simple), previous = f.runtime.snapshot.generation;
    await f.runtime.patchConfig([{ op: 'set', path: ['demo', 'count'], value: 8 }]);
    expect(f.runtime.snapshot.generation).toBeGreaterThan(previous);
    expect(field(await f.explain(), 'count')).toMatchObject({ candidateOrigin: 'file', generationMatch: 'equal', generationOrigin: 'unknown' });
    const generation = f.runtime.snapshot.generation;
    await expect(f.runtime.patchConfig([{ op: 'set', path: ['demo', 'count'], value: 'PRIVATE_REJECTED_CANDIDATE' }])).rejects.toThrow();
    expect(f.runtime.snapshot.generation).toBe(generation);
    expect(field(await f.explain(), 'count').generationMatch).toBe('equal');
  });

  it('returns no partial evidence without a Runtime authority', async () => {
    const f = await fixture(simple);
    const result = await new PluginManagementWorkflow(f.root).explainConfiguration('demo', (await f.document.read()).revision);
    expect(result).toMatchObject({ generation: null, projection: 'unsupported', reason: 'instance-unavailable', fields: [] });
  });

  it('requires the exact saved revision before any generation comparison', async () => {
    const f = await fixture(simple), revision = (await f.document.read()).revision; await f.save({ count: 9 });
    await expect(f.workflow.explainConfiguration('demo', revision)).rejects.toThrow('重新读取文件版本');
  });

  it('uses the real authenticated HTTP/RPC scope and never enters the authority for demo or invalid credentials', async () => {
    const f = await fixture(simple), explain = vi.spyOn(f.workflow, 'explainConfiguration');
    const host = createHttpHost({ host: '127.0.0.1', port: 0, token: 'synthetic-full-token', tokens: [{ token: 'synthetic-demo-token', scope: 'demo' }] });
    host.route('POST', '/api/console/request', async (request, response, _url, scope) => {
      const message = await readJsonBody<Record<string, unknown>>(request) ?? {};
      const replies = await dispatchRuntimeConsoleRpc(message, { authScope: scope, listPages: async () => [], pluginManagement: f.workflow });
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(pickRpcReply(message, replies)));
    });
    const { port } = await host.listen();
    const message = { type: CONFIG_RPC.EXPLAIN, instanceKey: 'demo', expectedRevision: (await f.document.read()).revision, requestId: 7 };
    const request = (token?: string, body = message) => fetch(`http://127.0.0.1:${port}/api/console/request`, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      expect(DEMO_RPC_ALLOWLIST.has(CONFIG_RPC.EXPLAIN)).toBe(false);
      expect((await request()).status).toBe(401); expect((await request('wrong')).status).toBe(401);
      expect(await (await request('synthetic-demo-token')).json()).toMatchObject({ error: expect.stringMatching(/Demo scope/) }); expect(explain).not.toHaveBeenCalled();
      const valid = await (await request('synthetic-full-token')).json() as { data: ConsoleConfigExplanation };
      expect(valid.data).toMatchObject({ projection: 'supported', instanceKey: 'demo' }); expect(explain).toHaveBeenCalledTimes(1);
      expect(valid.data.projectRevision).toMatch(/^[a-f0-9]{64}$/u);
      explain.mockRejectedValueOnce(new Error('PRIVATE_AUTHORITY_ERROR'));
      const failed = await (await request('synthetic-full-token')).json(); expect(failed).toMatchObject({ error: expect.stringMatching(/重新读取/) }); expect(JSON.stringify(failed)).not.toContain('PRIVATE_AUTHORITY_ERROR');
      const missingRevision = { ...message, expectedRevision: '' }; expect(await (await request('synthetic-full-token', missingRevision)).json()).toMatchObject({ error: expect.any(String) }); expect(explain).toHaveBeenCalledTimes(2);
    } finally { await host.close(); }
  });
});
