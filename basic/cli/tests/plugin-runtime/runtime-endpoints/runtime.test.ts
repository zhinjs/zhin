import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Adapter, AdapterIndex, adapterFeature, adapterFeatureId, createEndpointSpecification, defineAdapter,
  endpointDesiredRepositoryToken, endpointEventGatewayToken, endpointSpec, type PlatformEndpoint } from '@zhin.js/adapter';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { createDatabaseHost, installDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { PersistentEndpointRepository } from '../../../src/plugin-runtime/runtime-endpoints/state.js';

class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  async load<T>(source: string) { if (!this.values.has(source)) throw new Error(`Missing synthetic module ${source}`); return this.values.get(source) as T; }
  invalidate() {} affectedSources(source: string) { return [source]; } async close() {}
}
class NativeClient { constructor(readonly configuration: Readonly<Record<string, unknown>>) {} }
class Endpoint extends NativeClient implements PlatformEndpoint {
  readonly stopped = vi.fn();
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop: () => this.stopped(), send: async () => 'mid' });
}

it('restores Adapter-owned accounts after real SQLite reopen without changing Root generation, PID or startup files during mutations', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-endpoint-runtime-')));
  const json = async (file: string, data: unknown) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); };
  const application = { configVersion: 2 as const, plugins: {} };
  await json(join(root, 'package.json'), { name: '@test/endpoint-host', type: 'module',
    dependencies: { '@test/adapter': 'workspace:*', '@test/command': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/adapter' }, { package: '@test/command' }] } });
  for (const name of ['adapter', 'command']) await json(join(root, `packages/${name}/package.json`),
    { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
  for (const file of ['plugin.ts', 'packages/adapter/index.ts', 'packages/command/index.ts', 'adapters/native/index.ts', 'commands/status/index.ts']) {
    await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), '');
  }
  await json(join(root, 'zhin.config.json'), application);
  await writeFile(join(root, '.env'), 'SYNTHETIC_ONLY=fixture\n');
  const originalFiles = await Promise.all(['zhin.config.json', '.env'].map(name => readFile(join(root, name), 'utf8')));
  const config = { dialect: 'sqlite' as const, filename: join(root, 'state.sqlite') };
  const created: Endpoint[] = [];
  let runtime: RootRuntime | undefined;
  let database = createDatabaseHost(config);
  const start = async () => {
    const modules = new Modules();
    class Channel extends Adapter<Endpoint> {
      protected createEndpoint(configuration: Readonly<Record<string, unknown>>) {
        expect(database.started).toBe(true); // Desired state and Client construction run after DatabaseHost activation.
        const endpoint = new Endpoint(configuration); created.push(endpoint); return endpoint;
      }
    }
    modules.values.set(join(root, 'plugin.ts'), { default: definePlugin({ name: 'fixture' }) });
    modules.values.set(join(root, 'packages/adapter/index.ts'), { default: adapterFeature });
    modules.values.set(join(root, 'packages/command/index.ts'), { default: commandFeature });
    modules.values.set(join(root, 'adapters/native/index.ts'), { default: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new Channel() }) });
    modules.values.set(join(root, 'commands/status/index.ts'), { default: defineCommand({ execute: () => 'plugin-command-still-registered' }) });
    const repository = new PersistentEndpointRepository({ rootId: root, directory: join(root, '.zhin', 'endpoint-credentials'), state: () => database.state });
    runtime = new RootRuntime({ projectRoot: root, application, config: () => ({ endpoints: [{ id: 'legacy' }] }), modules,
      environment: { name: 'test', mode: 'test', platform: 'node' }, installResources(context) {
        installDatabaseHost(database)(context); context.resources.provide(endpointDesiredRepositoryToken, repository);
        context.resources.provide(endpointEventGatewayToken, { receive: async () => undefined });
      } });
    await runtime.start();
    const snapshot = runtime.snapshot;
    expect(snapshot.resources.get(snapshot.root)?.has(endpointDesiredRepositoryToken.id)).toBe(false);
    const index = snapshot.projections.get(adapterFeatureId) as AdapterIndex;
    expect(index).toBeDefined();
    expect(await (snapshot.projections.get(commandFeatureId) as CommandIndex).execute('status')).toBe('plugin-command-still-registered');
    return index.adapters()[0];
  };
  try {
    const adapter = await start();
    const generation = runtime!.snapshot.generation, pid = process.pid;
    const legacy = adapter.list()[0], legacyClient = adapter.getEndpoint(legacy.instanceId);
    expect(adapter.revision).toBeNull();
    const added = await adapter.add(null, { endpointId: 'new', config: { id: 'new', password: 'synthetic-new' } });
    const row = added.endpoints.find(item => item.endpointId === 'new')!;
    expect(adapter.getEndpoint(row.instanceId)).toBeUndefined();
    expect(created).toHaveLength(1);
    await adapter.start(row.instanceId, adapter.revision);
    const original = adapter.getEndpoint(row.instanceId)!;
    await adapter.update(row.instanceId, adapter.revision, { config: { id: 'new', password: 'synthetic-updated' } });
    expect(adapter.getEndpoint(legacy.instanceId)).toBe(legacyClient);
    expect(adapter.getEndpoint(row.instanceId)).not.toBe(original);
    expect(original.stopped).toHaveBeenCalledOnce();
    await adapter.stop(row.instanceId, adapter.revision);
    expect(runtime!.snapshot.generation).toBe(generation);
    expect(process.pid).toBe(pid);
    expect(await Promise.all(['zhin.config.json', '.env'].map(name => readFile(join(root, name), 'utf8')))).toEqual(originalFiles);
    await runtime!.stop(); await database.stop();
    database = createDatabaseHost(config);
    const count = created.length;
    const restored = await start();
    expect(restored.list().find(item => item.instanceId === row.instanceId)).toMatchObject({ canonicalId: row.canonicalId, desiredEnabled: false });
    expect(restored.getEndpoint(row.instanceId)).toBeUndefined();
    expect(created).toHaveLength(count + 1); // Only the still-enabled legacy account reconnects.
    const previousIdentity = row.canonicalId;
    await restored.remove(row.instanceId, restored.revision);
    const recreated = await restored.add(restored.revision, { endpointId: 'new', config: { id: 'new' } });
    expect(recreated.endpoints.find(item => item.endpointId === 'new')!.canonicalId).not.toBe(previousIdentity);
  } finally { await runtime?.stop(); await database.stop(); await rm(root, { recursive: true, force: true }); }
});
