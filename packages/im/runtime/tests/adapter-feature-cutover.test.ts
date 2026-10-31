import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import adapterFeature from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true }))); });

interface CutoverFixtureRequest { readonly api?: string; readonly providerApi?: string }
async function cutoverFixture(input: CutoverFixtureRequest) {
  const manifest = JSON.parse(await readFile(new URL('../../adapter/package.json', import.meta.url), 'utf8'));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-api-cutover-'))); temporary.push(root);
  const provider = join(root, 'packages/adapter'); await mkdir(provider, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@test/cutover', dependencies: { '@zhin.js/adapter': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts',
      features: [{ package: '@zhin.js/adapter', ...(input.api ? { api: input.api } : {}) }] } }));
  await writeFile(join(provider, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version,
    zhin: { protocol: 1, type: 'feature', entry: './index.ts', engine: manifest.zhin.engine,
      featureApi: input.providerApi ?? manifest.zhin.featureApi } }));
  await writeFile(join(root, 'plugin.ts'), ''); await writeFile(join(provider, 'index.ts'), '');
  const loads: string[] = []; let setups = 0;
  const modules: ModuleRuntime = { async load<T>(source: string): Promise<T> {
    loads.push(source);
    if (source === join(provider, 'index.ts')) return { default: adapterFeature } as T;
    if (source === join(root, 'plugin.ts')) return { default: definePlugin({ name: 'cutover', setup() { setups++; } }) } as T;
    throw new Error(`Unexpected module: ${source}`);
  }, async close() {} };
  const runtime = new RootRuntime({ projectRoot: root, modules, config: { configVersion: 2, plugins: {} },
    environment: { name: 'test', mode: 'test', platform: 'node' } });
  return { runtime, loads, setups: () => setups };
}

it('rejects an old explicit Adapter API consumer before any plugin/provider module is evaluated', async () => {
  const fixture = await cutoverFixture({ api: '^1.0.0' });
  try {
    await expect(fixture.runtime.start()).rejects.toThrow('requires ^1.0.0, provider declares 2.0.0');
    expect(fixture.loads).toEqual([]); expect(fixture.setups()).toBe(0);
  } finally { await fixture.runtime.stop(); }
});

it('rejects an API-2 consumer on an old API-1 provider before import or login', async () => {
  const fixture = await cutoverFixture({ api: '^2.0.0', providerApi: '1.0.0' });
  try {
    await expect(fixture.runtime.start()).rejects.toThrow('requires ^2.0.0, provider declares 1.0.0');
    expect(fixture.loads).toEqual([]); expect(fixture.setups()).toBe(0);
  } finally { await fixture.runtime.stop(); }
});

it.each(['^2.0.0', undefined])('accepts the current provider for declared API %s without adding a missing-API restriction', async api => {
  const fixture = await cutoverFixture({ api });
  try { await fixture.runtime.start(); expect(fixture.setups()).toBe(1); }
  finally { await fixture.runtime.stop(); }
});

it('still rejects malformed provider metadata even when the consumer omits its API range', async () => {
  const fixture = await cutoverFixture({ providerApi: 'not-semver' });
  try {
    await expect(fixture.runtime.start()).rejects.toThrow('declares invalid featureApi version not-semver');
    expect(fixture.loads).toEqual([]); expect(fixture.setups()).toBe(0);
  } finally { await fixture.runtime.stop(); }
});
