import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/runtime';
import { validateModelRuntimeConfig } from '@zhin.js/agent/config';
import { dispatchRuntimeConsoleRpc } from '@zhin.js/host-http';
import { ConsoleConfigurationStore } from '../../../../../host/gateway/src/config/configuration.js';

const loader = vi.hoisted(() => ({ available: true }));
vi.mock('../../../../../host/gateway/src/config/ai-config-loader.js', () => ({
  loadAiConfigUtils: () => loader.available ? { validateModelRuntimeConfig } : null,
}));
const roots: string[] = [];
afterEach(async () => { loader.available = true; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(ai: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-ai-config-validation-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-config', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  const file = join(root, 'zhin.config.json');
  const source = JSON.stringify({ configVersion: 2, plugins: {}, ai });
  await writeFile(file, source);
  const environment = vi.fn(() => ({ has: () => true }));
  const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(file), environmentForPlugin: environment });
  const write = vi.fn((name: string, data: unknown) => store.setKey(name, data));
  const save = (data: unknown) => dispatchRuntimeConsoleRpc({ type: 'config:set', pluginName: 'ai', data, requestId: 1 }, {
    authScope: 'full', listPages: async () => [], setConfigKey: write,
    validatePluginConfig: (name, value) => store.validatePluginConfig(name, value),
  });
  return { root, file, source, store, environment, write, save };
}

it.each([
  { providers: {} }, { providers: {}, enabled: 'invalid' }, { modelCatalog: {} }, { modelPolicy: {} }, { decisions: {} }, { plan: {} },
  { agents: { helper: { model: 'retired-native-selector' } } },
  { multimodal: { perception: { provider: 'retired' } } },
])('rejects retired startup selectors before environment lookup or an actual RPC save: %j', async value => {
  const f = await fixture();
  const input = structuredClone(value);
  expect(validateModelRuntimeConfig(input, 'host:test')).toEqual([expect.stringContaining('migration required')]);
  expect(await f.store.validatePluginConfig('ai', input)).toMatchObject({ valid: false, errors: [{ message: expect.stringContaining('migration required') }], missingEnv: [] });
  expect(await f.save(input)).toContainEqual(expect.objectContaining({ error: '配置校验失败' }));
  expect(f.write).not.toHaveBeenCalled(); expect(f.environment).not.toHaveBeenCalled();
  expect(await readFile(f.file, 'utf8')).toBe(f.source);
  expect(input).toEqual(value);
});

it('leaves legacy source readable for migration while refusing a structured patch that would retain its retired authority', async () => {
  const f = await fixture({ modelCatalog: {}, trigger: { ambient: { mode: 'active' } } });
  const snapshot = await f.store.readSource();
  expect(snapshot.source).toContain('modelCatalog');
  expect(await f.store.patch({ expectedRevision: snapshot.revision, patches: [
    { op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'], value: 'shadow' },
  ] })).toMatchObject({ status: 'invalid', errors: [{ path: '$.ai', message: expect.stringContaining('migration required') }] });
  expect(await readFile(f.file, 'utf8')).toBe(f.source);
  expect(f.environment).not.toHaveBeenCalled();
  // The explicit file-manager source path retains its existing contract.
  await f.store.replaceSource(JSON.stringify({ configVersion: 2, plugins: {}, ai: { providers: {} } }), snapshot.revision);
  expect((await f.store.readSource()).source).toContain('providers');
});

it('preserves legal startup extensions and saves through the same actual RPC authority', async () => {
  const f = await fixture();
  const value = { enabled: true, extension: { retained: true }, agents: { helper: { mcpServers: [] } } };
  expect(await f.save(value)).toContainEqual(expect.objectContaining({ data: { success: true, reloaded: false, restartRequired: true, message: '配置已保存，需重启进程才能生效' } }));
  expect(f.write).toHaveBeenCalledOnce();
  expect(JSON.parse(await readFile(f.file, 'utf8')).ai).toEqual(value);
});

it('reports unavailable Agent validation explicitly without writing or looking up environment values', async () => {
  loader.available = false;
  const f = await fixture();
  expect(await f.store.validatePluginConfig('ai', {})).toMatchObject({ valid: false,
    errors: [{ path: '$', message: 'AI configuration validation requires the installed Agent package' }] });
  expect(await f.save({ enabled: true })).toContainEqual(expect.objectContaining({ error: '配置校验失败' }));
  expect(f.write).not.toHaveBeenCalled(); expect(f.environment).not.toHaveBeenCalled();
  expect(await readFile(f.file, 'utf8')).toBe(f.source);
});
