import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { createCapabilityContext } from '@zhin.js/feature-kit';
import {
  applyConfigPatches,
  definePlugin,
  rootPluginId,
  type ConfigDocumentPort,
  type ConfigDocumentSnapshot,
  type ConfigPatch,
  type PluginDefinition,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { RootRuntime, primaryConfigToken, type PrimaryConfig, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];
const running: RootRuntime[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(runtime => runtime.stop()));
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true })));
});

describe('flat application Runtime', () => {
  it('projects primary config for retained owners and shadows it during new child setup without mutating old leases', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child', disabled: '@test/child' }, disable_plugins: ['disabled'], child: { token: 'before' }, disabled: {} });
    const seen: RuntimeConfigDocument[] = [];
    f.definitions.set(join(f.root, 'plugins/child/plugin.ts'), definePlugin({ ...f.child(), setup(context) {
      seen.push(context.resources.use(primaryConfigToken).document);
      f.setups.push(context.plugin.instanceKey);
    } }));
    const runtime = f.runtime();
    await runtime.start();
    const lease = runtime.snapshots.acquire();
    const primary = (snapshot: typeof runtime.snapshot) => snapshot.resources.get(rootPluginId())?.get(primaryConfigToken.id) as PrimaryConfig;
    await runtime.patchConfig([{ op: 'set', path: ['child', 'token'], value: 'after' }]);
    expect(seen.at(-1)?.child).toEqual({ token: 'after' });
    expect(primary(runtime.snapshot).document.child).toEqual({ token: 'after' });
    expect(primary(lease.value).document.child).toEqual({ token: 'before' });
    await runtime.patchConfig([{ op: 'set', path: ['disabled'], value: { draft: true } }]);
    expect(primary(runtime.snapshot).document.disabled).toEqual({ draft: true });
    expect(runtime.snapshot.resources.get('root/child' as never)?.get(primaryConfigToken.id)).toBe(primary(runtime.snapshot));
    expect(createCapabilityContext(runtime.snapshot, 'root/child' as never).use(primaryConfigToken).document.disabled).toEqual({ draft: true });
    expect(createCapabilityContext(lease.value, 'root/child' as never).use(primaryConfigToken).document.disabled).toEqual({});
    expect(f.setups).toEqual(['root', 'child', 'child']);
    const coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError(error) { throw error; } });
    f.document.replace({ ...f.document.document, disabled: { draft: false } });
    await coordinator.enqueue(f.document.sources[0]!);
    expect(primary(runtime.snapshot).document.disabled).toEqual({ draft: false });
    expect(f.setups).toEqual(['root', 'child', 'child']);
    lease.release();
    await coordinator.stop();
  });

  it.each(['reload', 'hmr'] as const)('restores the latest committed inputs when a queued %s fails after a patch', async kind => {
    const initial = { configVersion: 2, plugins: { child: '@test/child' }, child: { token: 'A' } };
    const f = await fixture(initial);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let attempts = 0;
    f.definitions.set(join(f.root, 'plugins/child/plugin.ts'), definePlugin({ ...f.child(), async setup({ config }) {
      if ((config.get() as { token: string }).token !== 'B') return;
      if (++attempts === 1) { enter(); await gate; }
      else throw new Error('queued setup failed');
    } }));
    const runtime = f.runtime();
    await runtime.start();
    const patch = runtime.patchConfig([{ op: 'set', path: ['child', 'token'], value: 'B' }]);
    await entered;
    const coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError() {} });
    const queued = kind === 'reload' ? runtime.reload() : coordinator.enqueue(join(f.root, 'plugins/child/plugin.ts'));
    const rejection = expect(queued).rejects.toThrow('queued setup failed');
    await setImmediate();
    release();
    await patch;
    await rejection;
    expect(runtime.snapshot.config.get('root/child' as never)).toEqual({ token: 'B' });
    f.document.replace(initial);
    await coordinator.enqueue(f.document.sources[0]!);
    expect(runtime.snapshot.config.get('root/child' as never)).toEqual({ token: 'A' });
    expect(runtime.snapshot.generation).toBe(3);
    await coordinator.stop();
  });
  it('does not import disabled plugin entries, retains incomplete config and isolates same-package instances', async () => {
    const f = await fixture({ configVersion: 2, plugins: { first: '@test/child', second: '@test/child', missing: '@test/missing' },
      disable_plugins: ['first', 'missing'], first: {}, second: { token: 'second' }, missing: {} });
    const runtime = f.runtime();
    await runtime.start();
    expect([...runtime.snapshot.tree.keys()]).toEqual(['root', 'root/second']);
    expect(f.setups).toEqual(['root', 'second']);
    expect(runtime.snapshot.config.get('root/second' as never)).toEqual({ token: 'second' });
    await runtime.patchConfig([
      { op: 'set', path: ['first'], value: { token: 'first' } },
      { op: 'set', path: ['disable_plugins'], value: ['missing'] },
    ]);
    expect(runtime.snapshot.config.get('root/first' as never)).toEqual({ token: 'first' });
    expect(runtime.snapshot.config.get('root/second' as never)).toEqual({ token: 'second' });
    expect(f.setups.filter(key => key === 'second')).toHaveLength(1);
    expect(f.setups.filter(key => key === 'first')).toHaveLength(1);
  });

  it('builds the candidate graph before validating a batch that adds an instance and required config', async () => {
    const f = await fixture({ configVersion: 2 });
    const runtime = f.runtime();
    await runtime.start();
    await runtime.patchConfig([
      { op: 'set', path: ['plugins'], value: { added: '@test/child' } },
      { op: 'set', path: ['added'], value: { token: 'ready' } },
    ]);
    expect(runtime.snapshot.config.get('root/added' as never)).toEqual({ token: 'ready' });
    expect(f.setups).toEqual(['root', 'added']);
    expect(f.document.document).toEqual({ configVersion: 2, plugins: { added: '@test/child' }, added: { token: 'ready' } });
  });

  it('can disable an instance and preserve invalid business config in the same transaction', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/child' }, child: { token: 'one' }, sibling: { token: 'two' } });
    const runtime = f.runtime();
    await runtime.start();
    const loads = f.loads.length;
    await runtime.patchConfig([
      { op: 'set', path: ['disable_plugins'], value: ['child'] },
      { op: 'set', path: ['child'], value: {} },
    ]);
    expect(runtime.snapshot.tree.has('root/child' as never)).toBe(false);
    expect(f.document.document.child).toEqual({});
    expect(f.setups.filter(key => key === 'sibling')).toHaveLength(1);
    // The shared child package still loads for the active sibling; the disabled
    // logical instance does not run setup or acquire any owned resources.
    expect(f.loads.length).toBeGreaterThanOrEqual(loads);
    const generation = runtime.snapshot.generation;
    await expect(runtime.patchConfig([{ op: 'set', path: ['disable_plugins'], value: [] }])).rejects.toThrow('token');
    expect(runtime.snapshot.generation).toBe(generation);
    expect(f.document.document.disable_plugins).toEqual(['child']);
  });

  it('rejects a required missing package without saving the candidate or changing the live generation', async () => {
    const f = await fixture({ configVersion: 2 });
    const runtime = f.runtime();
    await runtime.start();
    await expect(runtime.patchConfig([{ op: 'set', path: ['plugins'], value: { absent: '@test/missing' } }])).rejects.toThrow('@test/missing');
    expect(runtime.snapshot.generation).toBe(1);
    expect(f.document.document).toEqual({ configVersion: 2 });
    expect(f.document.rollbacks).toBe(1);
  });

  it('uses committed schema declarations to compare inputs without importing an owner being disabled', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child' }, child: { token: 'before' } });
    const runtime = f.runtime();
    await runtime.start();
    f.definitions.set(join(f.root, 'plugins/child/plugin.ts'), definePlugin({ name: 'child', config: {
      toJsonSchema() { throw new Error('retiring inline Schema must not be read'); },
    } }));
    f.loads.length = 0;
    await runtime.patchConfig([
      { op: 'set', path: ['disable_plugins'], value: ['child'] },
      { op: 'set', path: ['child'], value: {} },
    ]);
    expect(runtime.snapshot.tree.has('root/child' as never)).toBe(false);
    expect(f.loads).not.toContain(join(f.root, 'plugins/child/plugin.ts'));
  });

  it('uses the new package schema when replacing an existing alias implementation', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child' }, child: { token: 'before' } });
    const runtime = f.runtime();
    await runtime.start();
    await runtime.patchConfig([
      { op: 'set', path: ['plugins', 'child'], value: '@test/other' },
      { op: 'set', path: ['child'], value: { count: 3 } },
    ]);
    expect(runtime.snapshot.tree.get('root/child' as never)?.packageName).toBe('@test/other');
    expect(runtime.snapshot.config.get('root/child' as never)).toEqual({ count: 3 });
  });

  it('can repair an invalid external document using one candidate batch', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child' }, child: { token: 'valid' } });
    const runtime = f.runtime();
    await runtime.start();
    f.document.replace({ configVersion: 2, plugins: { child: '@test/child' }, child: {} });
    await expect(runtime.reload()).rejects.toThrow('token');
    await runtime.patchConfig([{ op: 'set', path: ['disable_plugins'], value: ['child'] }]);
    expect(runtime.snapshot.tree.has('root/child' as never)).toBe(false);
    expect(f.document.document.child).toEqual({});
    expect(f.setups).toEqual(['root', 'child']);
  });

  it('applies externally edited add/disable/config batches through the same candidate graph path', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child' }, child: { token: 'before' } });
    const runtime = f.runtime();
    await runtime.start();
    const errors: unknown[] = [];
    const coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError(error) { errors.push(error); } });
    f.document.replace({ configVersion: 2, plugins: { child: '@test/child', added: '@test/other' }, disable_plugins: ['child'], child: {}, added: { count: 4 } });
    await coordinator.enqueue(f.document.sources[0]!);
    expect(errors).toEqual([]);
    expect(runtime.snapshot.tree.has('root/child' as never)).toBe(false);
    expect(runtime.snapshot.config.get('root/added' as never)).toEqual({ count: 4 });
    expect(f.setups).toEqual(['root', 'child', 'added']);
    const committed = runtime.snapshot;
    f.document.replace({ configVersion: 2, plugins: { child: '@test/child' }, child: {} });
    await expect(coordinator.enqueue(f.document.sources[0]!)).rejects.toThrow('token');
    expect(errors).toHaveLength(1);
    expect(runtime.snapshot).toBe(committed);
    await coordinator.stop();
  });

  it('keeps source order for numeric aliases on startup and a watched reorder', async () => {
    const f = await fixture({ configVersion: 2, plugins: { '10': '@test/child', '2': '@test/child' }, '10': { token: 'ten' }, '2': { token: 'two' } });
    f.document.pluginOrder = ['10', '2'];
    const runtime = f.runtime();
    await runtime.start();
    expect(f.setups).toEqual(['root', '10', '2']);
    const coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError(error) { throw error; } });
    f.document.pluginOrder = ['2', '10'];
    f.document.replace(f.document.document);
    await coordinator.enqueue(f.document.sources[0]!);
    expect(runtime.snapshot.tree.get('root' as never)?.children).toEqual(['root/2', 'root/10']);
    expect(f.setups).toEqual(['root', '10', '2']);
    await coordinator.stop();
  });

  it('applies a pending source reorder even when the following API patch changes no business value', async () => {
    const f = await fixture({ configVersion: 2, plugins: { '10': '@test/child', '2': '@test/child' }, '10': { token: 'ten' }, '2': { token: 'two' } });
    f.document.pluginOrder = ['10', '2'];
    const runtime = f.runtime();
    await runtime.start();
    f.document.pluginOrder = ['2', '10'];
    f.document.replace(f.document.document);
    await runtime.patchConfig([{ op: 'set', path: ['10', 'token'], value: 'ten' }]);
    expect(runtime.snapshot.tree.get('root' as never)?.children).toEqual(['root/2', 'root/10']);
    expect(f.setups).toEqual(['root', '10', '2']);
  });

  it('preserves known numeric source order when a minimal structural port adds an alias without write metadata', async () => {
    const f = await fixture({ configVersion: 2, plugins: { '10': '@test/child', '2': '@test/child' }, '10': { token: 'ten' }, '2': { token: 'two' } });
    f.document.pluginOrder = ['10', '2'];
    const runtime = f.runtime();
    await runtime.start();
    await runtime.patchConfig([
      { op: 'set', path: ['plugins', '3'], value: '@test/child' },
      { op: 'set', path: ['3'], value: { token: 'three' } },
    ]);
    expect(runtime.snapshot.tree.get('root' as never)?.children).toEqual(['root/10', 'root/2', 'root/3']);
    expect(f.setups).toEqual(['root', '10', '2', '3']);
  });

  it('merges disjoint metadata fields and refreshes package metadata without restarting siblings', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child', sibling: '@test/other' }, child: { token: 'one' }, sibling: { count: 1 } });
    f.definitions.set(join(f.root, 'plugins/child/plugin.ts'), definePlugin({ ...f.child(), metadata: { icon: 'Bell', order: 5 } }));
    await f.childManifest({ metadata: { displayName: 'Before' } });
    const runtime = f.runtime();
    await runtime.start();
    expect(runtime.snapshot.tree.get('root/child' as never)?.metadata).toEqual({ displayName: 'Before', icon: 'Bell', order: 5 });
    const coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError(error) { throw error; } });
    await f.childManifest({ metadata: { displayName: 'After' } });
    await coordinator.enqueue(join(f.root, 'plugins/child/package.json'));
    expect(runtime.snapshot.tree.get('root/child' as never)?.metadata?.displayName).toBe('After');
    expect(f.setups.filter(key => key === 'sibling')).toHaveLength(1);
    await coordinator.stop();
  });

  it('rejects duplicate metadata even when values match and before executing plugin setup', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child' }, child: { token: 'one' } });
    f.definitions.set(join(f.root, 'plugins/child/plugin.ts'), definePlugin({ ...f.child(), metadata: { displayName: 'Same' } }));
    await f.childManifest({ metadata: { displayName: 'Same' } });
    await expect(f.runtime().start()).rejects.toThrow('metadata.displayName in both');
    expect(f.setups).toEqual(['root']);
  });

  it('checks isolated descriptor metadata while keeping its entry out of the composition process', async () => {
    const f = await fixture({ configVersion: 2, plugins: { child: '@test/child' }, child: {} });
    await f.childManifest({ runtime: 'isolated', metadata: { displayName: 'Isolated' } });
    let disposed = false;
    const runtime = new RootRuntime({ projectRoot: f.root, config: f.document, environment, modules: f.modules,
      isolation: { async prepare() { return { descriptor: { name: 'isolated', metadata: { displayName: 'Isolated' } }, async controlEvent() {}, dispose() { disposed = true; } }; } } });
    running.push(runtime);
    await expect(runtime.start()).rejects.toThrow('metadata.displayName in both');
    expect(f.loads).not.toContain(join(f.root, 'plugins/child/plugin.ts'));
    expect(disposed).toBe(true);
  });
});

const environment = { name: 'test', mode: 'test' as const, platform: 'node' };
const manifest = { protocol: 1, type: 'plugin', entry: './plugin.ts' };
async function fixture(initial: RuntimeConfigDocument) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-v2-runtime-')));
  temporary.push(root);
  await json(join(root, 'package.json'), { name: '@test/root', dependencies: { '@test/child': 'workspace:*', '@test/other': 'workspace:*' }, zhin: manifest });
  const childManifest = (extra: Record<string, unknown> = {}) => json(join(root, 'plugins/child/package.json'), { name: '@test/child', zhin: { ...manifest, ...extra } });
  await childManifest();
  await json(join(root, 'plugins/other/package.json'), { name: '@test/other', zhin: manifest });
  const setups: string[] = [];
  const setup: PluginDefinition['setup'] = context => { setups.push(context.plugin.instanceKey); };
  const child = () => definePlugin({ name: 'child', setup, config: {
    toJsonSchema: () => ({ type: 'object', required: ['token'], properties: { token: { type: 'string', minLength: 1 } }, additionalProperties: false }),
  } });
  const definitions = new Map<string, PluginDefinition>([
    [join(root, 'plugin.ts'), definePlugin({ name: 'root', setup })],
    [join(root, 'plugins/child/plugin.ts'), child()],
    [join(root, 'plugins/other/plugin.ts'), definePlugin({ name: 'other', setup, config: { toJsonSchema: () => ({ type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 1 } }, additionalProperties: false }) } })],
  ]);
  const loads: string[] = [];
  const modules: ModuleRuntime = {
    async load<T>(source: string): Promise<T> {
      loads.push(source);
      const definition = definitions.get(source);
      if (!definition) throw new Error(`Unexpected module ${source}`);
      return { default: definition } as T;
    },
    async close() {},
  };
  const document = new MemoryDocument(join(root, 'zhin.config.json'), initial);
  return { root, definitions, loads, setups, document, modules, child, childManifest,
    runtime() { const runtime = new RootRuntime({ projectRoot: root, config: document, modules, environment }); running.push(runtime); return runtime; },
  };
}

class MemoryDocument implements ConfigDocumentPort {
  readonly sources: readonly string[];
  document: RuntimeConfigDocument;
  revision = 0;
  rollbacks = 0;
  pluginOrder?: readonly string[];
  constructor(source: string, document: RuntimeConfigDocument) { this.sources = [source]; this.document = structuredClone(document); }
  async read(): Promise<ConfigDocumentSnapshot> { return { document: structuredClone(this.document), revision: String(this.revision), pluginOrder: this.pluginOrder }; }
  replace(document: RuntimeConfigDocument) {
    this.document = structuredClone(document);
    if (this.pluginOrder) {
      const keys = Object.keys(document.plugins as Record<string, unknown> ?? {});
      this.pluginOrder = [...this.pluginOrder.filter(key => keys.includes(key)), ...keys.filter(key => !this.pluginOrder?.includes(key))];
    }
    this.revision += 1;
  }
  async prepare(current: ConfigDocumentSnapshot, patches: readonly ConfigPatch[]) {
    const document = applyConfigPatches(current.document, patches);
    const commit = async () => { this.replace(document); return this.read(); };
    return {
      document,
      async commit() { return commit(); },
      rollback: async () => { this.rollbacks += 1; },
    };
  }
}
async function json(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); }
