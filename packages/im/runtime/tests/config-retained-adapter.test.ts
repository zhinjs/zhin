import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { definePlugin, applyConfigPatches, type ConfigDocumentPort, type ConfigDocumentSnapshot, type ConfigPatch, type PreparedConfigDocument, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import adapterFeature, { AdapterIndex, adapterFeatureId, defineAdapter, endpointEventGatewayToken, type EndpointEventSink } from '@zhin.js/adapter';
import handlerFeature, { HandlerIndex, handlerFeatureId, defineHandler } from '@zhin.js/handler';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

/** Real Runtime/AdapterIndex; only module bytes and the SDK transport are test boundaries. */
it('retains the untouched adapter transport across config source HMR, patches and failed sibling reload', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-retained-adapter-')));
  let runtime: RootRuntime | undefined;
  let coordinator: ReturnType<RootRuntime['createHmrCoordinator']> | undefined;
  const modules = new Modules();
  const transports = { create: 0, connect: 0, stop: 0 };
  const sinks: EndpointEventSink[] = [];
  const configSource = join(root, 'zhin.config.yml');
  const config = new ConfigPort(configSource, { plugins: { icqq: { label: 'account-v1' }, reminder: { label: 'max-20' } } });
  try {
    const put = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); };
    await put(join(root, 'package.json'), { name: '@test/root', dependencies: { '@test/icqq': 'workspace:*', '@test/reminder': 'workspace:*', '@test/watcher': 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [{ package: '@test/watcher', instanceKey: 'watcher' }, { package: '@test/icqq', instanceKey: 'icqq' }, { package: '@test/reminder', instanceKey: 'reminder' }] } });
    for (const [name, feature] of [['icqq', 'adapter'], ['reminder', 'command'], ['watcher', 'handler']]) {
      await put(join(root, `plugins/${name}/package.json`), { name: `@test/${name}`, dependencies: { [`@test/${feature}`]: 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: `@test/${feature}` }] } });
      await put(join(root, `plugins/${name}/schema.json`), { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } } });
      await put(join(root, `plugins/${name}/plugin.ts`), {});
    }
    for (const name of ['adapter', 'command', 'handler']) {
      await put(join(root, `packages/${name}/package.json`), { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
      await put(join(root, `packages/${name}/index.ts`), {});
    }
    await put(join(root, 'plugin.ts'), {});
    const adapterSource = join(root, 'plugins/icqq/adapters/icqq/index.ts');
    const commandSource = join(root, 'plugins/reminder/commands/settings/index.ts');
    await put(adapterSource, {}); await put(commandSource, {});
    modules.set(join(root, 'plugins/watcher/plugin.ts'), { default: definePlugin({ name: 'watcher' }) });
    modules.set(join(root, 'packages/handler/index.ts'), { default: handlerFeature });
    modules.set(join(root, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(root, 'plugins/icqq/plugin.ts'), { default: definePlugin({ name: 'icqq' }) });
    modules.set(join(root, 'plugins/reminder/plugin.ts'), { default: definePlugin({ name: 'reminder', setup({ config, handoff }) { const label = (config.get() as { label: string }).label; if (label === 'broken') throw new Error('reminder setup failed'); if (label === 'activation-broken') handoff.add({ activateNext() { throw new Error('reminder activation failed'); } }); } }) });
    modules.set(join(root, 'packages/adapter/index.ts'), { default: adapterFeature });
    modules.set(join(root, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(adapterSource, { default: defineAdapter({ capabilities: ['inbound', 'outbound'], create(context) {
      transports.create++;
      return { client: { account: (context.config as { label: string }).label, readProjection: () => (context as unknown as { project(feature: unknown): unknown }).project(commandFeatureId) }, connect({ events }) { transports.connect++; sinks.push(events); return () => { transports.stop++; }; }, send: () => 'synthetic-id' };
    } }) });
    modules.set(commandSource, { default: defineCommand({ execute: ({ config }) => (config as { label: string }).label }) });
    const handlerSource = join(root, 'plugins/watcher/handlers/diagnostic/index.ts');
    await put(handlerSource, {});
    const crossFeature: Array<{ generation: number; label: unknown; account: string }> = [];
    modules.set(handlerSource, { default: defineHandler({ event: 'diagnostic.receive', async handle() {
      const commands = this.project<CommandIndex>(commandFeatureId);
      const adapters = this.project<AdapterIndex>(adapterFeatureId);
      const client = adapters.clientById<{ account: string }>(adapters.list()[0]!.id);
      crossFeature.push({ generation: this.generation, label: await commands.execute('settings'), account: client.account });
    } }) });
    const observations: number[] = [];
    const verifyHandler = async (label: string, account: string) => {
      const snapshot = runtime!.snapshot;
      await (snapshot.projections.get(handlerFeatureId) as HandlerIndex).dispatch('diagnostic.receive', [], { snapshot });
      expect(crossFeature.at(-1)).toEqual({ generation: snapshot.generation, label, account });
    };
    runtime = new RootRuntime({ projectRoot: root, modules, config, environment: { name: 'test', mode: 'test', platform: 'node' }, installResources({ resources }) { resources.provide(endpointEventGatewayToken, { receive: async () => { observations.push(runtime!.snapshot.generation); } }); } });
    const first = await runtime.start();
    const firstIndex = first.projections.get(adapterFeatureId) as AdapterIndex;
    const oldLease = runtime.snapshots.acquire();
    await verifyHandler('max-20', 'account-v1');
    const client = firstIndex.clientById<{ readProjection(): unknown }>(firstIndex.list()[0]!.id);
    expect(() => client.readProjection()).toThrow(/project/);
    coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError() {} });

    // Console source replacement writes this same watched document boundary.
    config.writeExternal({ plugins: { icqq: { label: 'account-v1' }, reminder: { label: 'max-21' } } });
    await coordinator.enqueue(configSource);
    expect(runtime.snapshot.generation).toBe(2);
    expect(runtime.snapshot.projections.get(adapterFeatureId)).toBe(firstIndex);
    expect(firstIndex.clientById(firstIndex.list()[0]!.id)).toBe(client);
    expect(transports).toEqual({ create: 1, connect: 1, stop: 0 });
    await sinks[0]!.message({ content: 'alive', conversation: { kind: 'private', id: 'u1' }, sender: { id: 'u1' } });
    expect(observations).toEqual([2]);
    expect(await (runtime.snapshot.projections.get(commandFeatureId) as CommandIndex).execute('settings')).toBe('max-21');
    await verifyHandler('max-21', 'account-v1');
    expect(() => client.readProjection()).toThrow(/project/);
    oldLease.release(); await setImmediate();
    expect(transports.stop).toBe(0);

    await runtime.patchConfig([{ op: 'set', path: ['plugins', 'reminder', 'label'], value: 'max-22' }]);
    expect(runtime.snapshot.projections.get(adapterFeatureId)).toBe(firstIndex);
    await expect(runtime.patchConfig([{ op: 'set', path: ['plugins', 'reminder', 'label'], value: 'broken' }])).rejects.toThrow('reminder setup failed');
    await expect(runtime.patchConfig([{ op: 'set', path: ['plugins', 'reminder', 'label'], value: 'activation-broken' }])).rejects.toThrow('reminder activation failed');
    expect(runtime.snapshot.projections.get(adapterFeatureId)).toBe(firstIndex);
    expect(transports).toEqual({ create: 1, connect: 1, stop: 0 });
    await sinks[0]!.message({ content: 'still alive', conversation: { kind: 'private', id: 'u1' }, sender: { id: 'u1' } });
    expect(observations.at(-1)).toBe(3);
    modules.set(commandSource, { default: defineCommand({ execute: ({ config }) => `${(config as { label: string }).label}:slot` }) });
    await coordinator.enqueue(commandSource);
    await verifyHandler('max-22:slot', 'account-v1');
    expect(() => client.readProjection()).toThrow(/project/);
    expect(runtime.snapshot.projections.get(adapterFeatureId)).toBe(firstIndex);
    expect(transports).toEqual({ create: 1, connect: 1, stop: 0 });
    const reminderIndex = runtime.snapshot.projections.get(commandFeatureId);

    // A real account configuration edit must still construct/activate its replacement.
    await runtime.patchConfig([{ op: 'set', path: ['plugins', 'icqq', 'label'], value: 'account-v2' }]);
    expect(runtime.snapshot.projections.get(adapterFeatureId)).not.toBe(firstIndex);
    expect(runtime.snapshot.projections.get(commandFeatureId)).not.toBe(reminderIndex);
    expect(await (runtime.snapshot.projections.get(commandFeatureId) as CommandIndex).execute('settings')).toBe('max-22:slot');
    await verifyHandler('max-22:slot', 'account-v2');
    expect(transports.create).toBe(2); expect(transports.connect).toBe(2);
    await setImmediate(); expect(transports.stop).toBe(1);
    await runtime.stop(); expect(transports.stop).toBe(2);
  } finally { await coordinator?.stop(); await runtime?.stop(); await rm(root, { recursive: true, force: true }); }
});

class Modules implements ModuleRuntime {
  readonly modules = new Map<string, unknown>();
  set(source: string, value: unknown) { this.modules.set(source, value); }
  async load<T>(source: string): Promise<T> { if (!this.modules.has(source)) throw new Error(`Missing fixture module: ${source}`); return this.modules.get(source) as T; }
  invalidate() {}
  async close() {}
}
class ConfigPort implements ConfigDocumentPort {
  readonly sources: readonly string[];
  private revision = 0;
  private document: RuntimeConfigDocument;
  constructor(source: string, document: RuntimeConfigDocument) { this.sources = [source]; this.document = structuredClone(document); }
  writeExternal(document: RuntimeConfigDocument) { this.document = structuredClone(document); this.revision++; }
  async read(): Promise<ConfigDocumentSnapshot> { return { document: structuredClone(this.document), revision: String(this.revision) }; }
  async prepare(current: ConfigDocumentSnapshot, patches: readonly ConfigPatch[]): Promise<PreparedConfigDocument> {
    const document = applyConfigPatches(current.document, patches);
    return { document, commit: async () => { this.writeExternal(document); return this.read(); }, rollback: async () => undefined };
  }
}
