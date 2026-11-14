import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import adapterFeature, {
  Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec, endpointEventGatewayToken,
} from '@zhin.js/adapter';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import toolFeature, { ToolIndex, defineAgentTool, toolFeatureId } from '@zhin.js/tool';
import {
  RootHost, type GenerationInvalidationPlan, type HmrReloadReport, type ModuleRuntime,
} from '../src/index.js';

/**
 * #1250 `hmr-multi-change-full-rebuild` / `hmr-stale-cross-package-import`: a reload rebuilds the
 * affected subtrees only. Adapters are rebuilt only for their own sources or configuration, and
 * Root capability / resource changes never reconnect an Endpoint. Real RootHost, AdapterIndex,
 * Command and Tool Features; module bytes and the SDK transport are the test boundaries.
 */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose(); });

describe('HMR rebuild scope (#1250)', () => {
  it('rebuilds only the two changed Plugin subtrees and keeps the adapter Endpoint', async () => {
    const f = await fixture();
    const index = adapters(f.host);
    f.modules.set(f.sources.opsEntry, { default: definePlugin({ name: 'qq-ops', setup: () => { f.setups.push('qq-ops:v2'); } }) });
    f.modules.set(f.sources.forecast, { default: forecastCommand('v2') });
    await writeFile(f.sources.wttr, 'export const forecast = "v2";\n');

    expect(await f.host.reloadSources([f.sources.opsEntry, f.sources.wttr])).toBe('reloaded');

    expect(f.reports.at(-1)).toMatchObject({ rebuilt: 'subtree', plugins: ['root/qq-ops', 'root/weather'] });
    expect(f.reports.at(-1)?.reason).toBeUndefined();
    expect(f.setups).toEqual(['root', 'icqq', 'qq-ops', 'weather', 'qq-ops:v2', 'weather']);
    expect(await commands(f.host).execute('forecast')).toBe('forecast:v2');
    expect(adapters(f.host)).toBe(index);
    expect(f.transports).toEqual({ create: 1, connect: 1, stop: 0 });
  });

  it('hands a changed AGENTS.md to the installer that reads it, without rebuilding any Plugin', async () => {
    const f = await fixture();
    const index = adapters(f.host);
    const generation = f.host.runtime.snapshot.generation;
    await writeFile(join(f.root, 'AGENTS.md'), '# bot v2\n');

    expect(await f.host.reloadSources([join(f.root, 'AGENTS.md')])).toBe('reloaded');

    expect(f.reports.at(-1)).toEqual({
      kind: 'reloaded', rebuilt: 'resource', plugins: [], capabilities: [], resources: [join(f.root, 'AGENTS.md')],
    });
    expect(f.agents.notified).toEqual([[join(f.root, 'AGENTS.md')]]);
    expect(f.agents.text).toBe('# bot v2\n');
    expect(f.host.runtime.snapshot.generation).toBe(generation);
    expect(f.setups).toEqual(['root', 'icqq', 'qq-ops', 'weather']);
    expect(adapters(f.host)).toBe(index);
    expect(f.transports).toEqual({ create: 1, connect: 1, stop: 0 });
  });

  it('still rebuilds the Root for an undeclared Root file, and says why', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'NOTES.md'), 'scratch\n');
    expect(await f.host.reloadSources([join(f.root, 'NOTES.md')])).toBe('reloaded');
    expect(f.reports.at(-1)).toMatchObject({
      rebuilt: 'root',
      reason: `changed Root Plugin files are not a convention capability and no Root installer declared reading them: ${join(f.root, 'NOTES.md')}`,
    });
    expect(f.agents.notified).toEqual([]);
  });

  it('replaces only the changed Root command and tool, never the adapter', async () => {
    const f = await fixture();
    const index = adapters(f.host);
    f.modules.set(f.sources.ping, { default: defineCommand({ execute: () => 'pong:v2' }) });
    f.modules.set(f.sources.lookup, { default: lookupTool('v2') });

    expect(await f.host.reloadSources([f.sources.ping, f.sources.lookup])).toBe('reloaded');

    expect(f.reports.at(-1)).toMatchObject({ rebuilt: 'capability', plugins: [] });
    expect(f.reports.at(-1)?.capabilities).toHaveLength(2);
    expect(await commands(f.host).execute('ping')).toBe('pong:v2');
    await expect(lookup(f.host.runtime.snapshot)).resolves.toBe('lookup:v2');
    expect(f.setups).toEqual(['root', 'icqq', 'qq-ops', 'weather']);
    expect(adapters(f.host)).toBe(index);
    expect(f.transports).toEqual({ create: 1, connect: 1, stop: 0 });
  });

  it('reloads a Root tool importing a changed workspace Plugin module, with that Plugin, in one generation', async () => {
    const f = await fixture();
    const index = adapters(f.host);
    // The Root tool imports `@test/weather/wttr` by package name; the module runtime maps it back.
    f.modules.dependents.set(f.sources.wttr, [f.sources.weatherEntry, f.sources.lookup]);
    f.modules.set(f.sources.lookup, { default: lookupTool('wttr-v2') });
    const loads = f.modules.loadCount(f.sources.lookup);

    expect(await f.host.reloadSources([f.sources.wttr])).toBe('reloaded');

    expect(f.modules.loadCount(f.sources.lookup)).toBe(loads + 1);
    await expect(lookup(f.host.runtime.snapshot)).resolves.toBe('lookup:wttr-v2');
    expect(f.reports.at(-1)).toMatchObject({ rebuilt: 'subtree', plugins: ['root/weather'] });
    expect(f.reports.at(-1)?.capabilities).toHaveLength(1);
    expect(adapters(f.host)).toBe(index);
    expect(f.transports).toEqual({ create: 1, connect: 1, stop: 0 });
  });

  it('lists importers a reload cannot refresh as unrefreshed dependents', async () => {
    const f = await fixture();
    f.modules.stale.set(f.sources.wttr, [join(f.root, 'plugins/qq-ops/plugin.ts')]);
    expect(await f.host.reloadSources([f.sources.wttr])).toBe('reloaded');
    expect(f.plans.at(-1)?.unrefreshedDependents).toEqual([join(f.root, 'plugins/qq-ops/plugin.ts')]);
  });

  it('rebuilds the adapter Plugin when its own source changes', async () => {
    const f = await fixture();
    const index = adapters(f.host);
    expect(await f.host.reloadSources([f.sources.adapterEntry])).toBe('reloaded');
    expect(f.reports.at(-1)).toMatchObject({ rebuilt: 'subtree', plugins: ['root/icqq'] });
    expect(adapters(f.host)).not.toBe(index);
    expect(f.transports.create).toBe(2);
    expect(f.transports.connect).toBe(2);
  });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-hmr-scope-')));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const put = async (path: string, value: unknown) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const plugin = (name: string, features: readonly string[]) => ({
    name: `@test/${name}`, type: 'module',
    dependencies: Object.fromEntries(features.map((feature) => [`@test/${feature}`, 'workspace:*'])),
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', platformFeatures: false, features: features.map((feature) => ({ package: `@test/${feature}` })) },
  });
  await put(join(root, 'package.json'), plugin('root', ['command', 'tool']));
  await put(join(root, 'plugins/icqq/package.json'), plugin('icqq', ['adapter']));
  await put(join(root, 'plugins/qq-ops/package.json'), plugin('qq-ops', []));
  await put(join(root, 'plugins/weather/package.json'), plugin('weather', ['command']));
  for (const name of ['adapter', 'command', 'tool']) {
    await put(join(root, `packages/${name}/package.json`), { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
  }
  const sources = {
    rootEntry: join(root, 'plugin.ts'),
    adapterEntry: join(root, 'plugins/icqq/plugin.ts'),
    adapter: join(root, 'plugins/icqq/adapters/icqq/index.ts'),
    opsEntry: join(root, 'plugins/qq-ops/plugin.ts'),
    weatherEntry: join(root, 'plugins/weather/plugin.ts'),
    wttr: join(root, 'plugins/weather/src/wttr.ts'),
    forecast: join(root, 'plugins/weather/commands/forecast/index.ts'),
    ping: join(root, 'commands/ping/index.ts'),
    lookup: join(root, 'tools/lookup/index.ts'),
  };
  for (const source of Object.values(sources)) await put(source, 'export default {};\n');
  await put(sources.wttr, 'export const forecast = "v1";\n');
  await put(join(root, 'AGENTS.md'), '# bot\n');

  const setups: string[] = [];
  const transports = { create: 0, connect: 0, stop: 0 };
  const modules = new Modules();
  modules.set(join(root, 'packages/adapter/index.ts'), { default: adapterFeature });
  modules.set(join(root, 'packages/command/index.ts'), { default: commandFeature });
  modules.set(join(root, 'packages/tool/index.ts'), { default: toolFeature });
  for (const [name, source] of [['root', sources.rootEntry], ['icqq', sources.adapterEntry], ['qq-ops', sources.opsEntry], ['weather', sources.weatherEntry]] as const) {
    modules.set(source, { default: definePlugin({ name, setup: () => { setups.push(name); } }) });
  }
  modules.set(sources.adapter, { default: testAdapter(transports) });
  modules.set(sources.forecast, { default: forecastCommand('v1') });
  modules.set(sources.ping, { default: defineCommand({ execute: () => 'pong:v1' }) });
  modules.set(sources.lookup, { default: lookupTool('v1') });
  // The weather entry imports its support module relatively.
  modules.dependents.set(sources.wttr, [sources.weatherEntry]);

  const agents = { text: '', notified: [] as string[][] };
  const reports: HmrReloadReport[] = [];
  const plans: GenerationInvalidationPlan[] = [];
  const host = new RootHost({
    projectRoot: root, modules, watch: [],
    config: { configVersion: 2, plugins: { icqq: './plugins/icqq', 'qq-ops': './plugins/qq-ops', weather: './plugins/weather' }, icqq: {} },
    environment: { name: 'test', mode: 'test', platform: 'node' },
    async installResources({ resources, watchProjectFiles }) {
      const receive = async () => undefined;
      resources.provide(endpointEventGatewayToken, { run: async (execute) => execute({ receive }), receive });
      agents.text = await readFile(join(root, 'AGENTS.md'), 'utf8');
      watchProjectFiles?.({
        patterns: ['AGENTS.md', 'knowledge/**'],
        async onChange({ files }) {
          agents.notified.push([...files]);
          agents.text = await readFile(join(root, 'AGENTS.md'), 'utf8');
        },
      });
    },
    onReload: (plan, _generation, _duration, report) => { plans.push(plan); if (report) reports.push(report); },
    onRestartRequired: (plan) => { throw new Error(`Unexpected restart: ${plan.reasons.join()}`); },
    onError: (error) => { throw error; },
  });
  cleanups.push(() => host.stop());
  await host.start();
  expect(transports).toEqual({ create: 1, connect: 1, stop: 0 });
  return { root, host, modules, sources, setups, transports, agents, reports, plans };
}

function testAdapter(transports: { create: number; connect: number; stop: number }) {
  return defineAdapter<Record<string, never>>({ capabilities: ['inbound', 'outbound'], createAdapter() {
    class TestEndpoint {
      readonly [endpointSpec] = createEndpointSpecification(this, {
        start: () => { transports.connect++; },
        open() {}, close() {}, stop: () => { transports.stop++; }, send: () => 'synthetic-id',
      });
    }
    class TestAdapter extends Adapter<TestEndpoint, Record<string, never>> {
      protected createEndpoint(): TestEndpoint { transports.create++; return new TestEndpoint(); }
    }
    return new TestAdapter();
  } });
}

function forecastCommand(version: string) {
  return defineCommand({ execute: () => `forecast:${version}` });
}

function lookupTool(version: string) {
  return defineAgentTool({ description: 'Lookup', execute: () => `lookup:${version}` });
}

function adapters(host: RootHost): AdapterIndex {
  return host.runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex;
}

function commands(host: RootHost): CommandIndex {
  return host.runtime.snapshot.projections.get(commandFeatureId) as CommandIndex;
}

function lookup(snapshot: RuntimeSnapshot): Promise<unknown> {
  return (snapshot.projections.get(toolFeatureId) as ToolIndex).execute({
    requester: rootPluginId(), name: 'lookup', input: {}, snapshot,
    invocation: {
      signal: new AbortController().signal, traceId: 'trace', turnId: 'turn', sessionKey: 'session',
      origin: { kind: 'internal', source: 'runtime-test' },
      principal: { subjectId: 'user', roles: ['user'] },
      policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
    },
  });
}

class Modules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();
  /** Loaded entries importing a support module (what NativeDevelopmentModuleRuntime derives). */
  readonly dependents = new Map<string, readonly string[]>();
  readonly stale = new Map<string, readonly string[]>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  loadCount(source: string): number { return this.#loads.get(source) ?? 0; }
  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fixture module: ${source}`);
    this.#loads.set(source, this.loadCount(source) + 1);
    return this.#modules.get(source) as T;
  }
  affectedSources(source: string): readonly string[] { return [source, ...(this.dependents.get(source) ?? [])]; }
  staleDependents(source: string): readonly string[] { return this.stale.get(source) ?? []; }
  invalidate(): void {}
  watch() { return () => undefined; }
  async close(): Promise<void> {}
}
