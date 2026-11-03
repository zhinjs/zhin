import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyConfigPatches, definePlugin, type ConfigDocumentPort, type ConfigDocumentSnapshot, type ConfigPatch,
  type PreparedConfigDocument, type RuntimeConfigDocument, type SnapshotLease } from '@zhin.js/plugin-runtime';
import adapterFeature, { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification,
  defineAdapter, endpointSpec, endpointEventGatewayToken } from '@zhin.js/adapter';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import icqqPlugin from '../../../../plugins/adapters/icqq/plugin.js';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

/** Real first-party setup/ownership declaration and both Features; only module IO and SDK transport are fake. */
it.each([
  { declared: true, change: 'profile' }, { declared: false, change: 'profile' },
  { declared: true, change: 'topology' }, { declared: true, change: 'slot' },
  { declared: true, change: 'adapter-slot' },
])('uses the ICQQ profile ownership declaration=$declared with $change changes without bypassing command projection updates', async ({ declared, change }) => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-profile-owner-')));
  let runtime: RootRuntime | undefined;
  let previous: SnapshotLease | undefined;
  let coordinator: ReturnType<RootRuntime['createHmrCoordinator']> | undefined;
  const modules = new Modules();
  const transports = { create: 0, connect: 0, stop: 0, setup: 0 };
  try {
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value));
    };
    await put(join(project, 'package.json'), { name: '@test/profile-root', dependencies: { '@test/icqq': 'workspace:*', '@test/extra': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
    await put(join(project, 'plugins/icqq/package.json'), { name: '@test/icqq',
      dependencies: { '@test/adapter': 'workspace:*', '@test/command': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/adapter' }, { package: '@test/command' }] } });
    await put(join(project, 'plugins/icqq/schema.json'), { type: 'object', additionalProperties: false,
      properties: { nickname: { type: 'string' }, profile: { type: 'object' } } });
    await put(join(project, 'plugins/extra/package.json'), { name: '@test/extra', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
    await put(join(project, 'plugins/extra/plugin.ts'), {});
    modules.set(join(project, 'plugins/extra/plugin.ts'), { default: definePlugin({ name: 'extra' }) });
    for (const name of ['adapter', 'command']) {
      await put(join(project, `packages/${name}/package.json`), { name: `@test/${name}`,
        zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
      await put(join(project, `packages/${name}/index.ts`), {});
    }
    const adapterSource = join(project, 'plugins/icqq/adapters/icqq/index.ts');
    const commandSource = join(project, 'plugins/icqq/commands/profile-view/index.ts');
    await put(join(project, 'plugin.ts'), {});
    await put(join(project, 'plugins/icqq/plugin.ts'), {});
    await put(adapterSource, {});
    await put(commandSource, {});
    modules.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
    modules.set(join(project, 'plugins/icqq/plugin.ts'), { default: definePlugin({ ...icqqPlugin,
      configUpdate: declared ? icqqPlugin.configUpdate : undefined,
      setup(context) { transports.setup++; return icqqPlugin.setup?.(context); },
    }) });
    modules.set(join(project, 'packages/adapter/index.ts'), { default: adapterFeature });
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    const adapterDefinition = (messageId: string) => defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter() {
      class Client {
        readonly [endpointSpec] = createEndpointSpecification(this, {
          start() { transports.connect++; }, open() {}, close() {}, stop() { transports.stop++; }, send: async () => messageId,
        });
      }
      return new class extends Adapter<Client> {
        protected createEndpoint() { transports.create++; return new Client(); }
      }();
    } });
    modules.set(adapterSource, { default: adapterDefinition('profile-message') });
    modules.set(commandSource, { default: defineCommand({ execute: ({ config }) => (config as { nickname: string }).nickname }) });
    const beforeProfile = { signature: 'Before signature', birthday: '2000-01-02' };
    const afterProfile = { signature: 'After signature', birthday: '2001-03-04' };
    const config = new ConfigPort(join(project, 'zhin.config.json'), { configVersion: 2, plugins: { icqq: '@test/icqq' },
      icqq: { nickname: 'Before', profile: beforeProfile } });
    runtime = new RootRuntime({ projectRoot: project, modules, config,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources }) {
        resources.provide(endpointEventGatewayToken, { run: async receive => receive({ receive: async () => undefined }), receive: async () => undefined });
      },
    });
    const initial = await runtime.start();
    const oldIndex = initial.projections.get(adapterFeatureId) as AdapterIndex;
    const oldCommands = initial.projections.get(commandFeatureId) as CommandIndex;
    const id = oldIndex.list()[0].id;
    const oldClient = oldIndex.clientById(id);
    const oldPort = oldIndex.profile(id)!;
    expect(oldPort.peek().values).toEqual({ nickname: 'Before', ...beforeProfile });
    previous = runtime.snapshots.acquire();
    if (change === 'slot' || change === 'adapter-slot') {
      if (change === 'slot') modules.set(commandSource, { default: defineCommand({ execute: ({ config }) => `${(config as { nickname: string }).nickname}:updated` }) });
      else modules.set(adapterSource, { default: adapterDefinition('profile-message-v2') });
      config.writeExternal({ ...config.document, icqq: { nickname: 'After', profile: afterProfile } });
      coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('unexpected restart'); }, onError(error) { throw error; } });
      await Promise.all([coordinator.enqueue(config.sources[0]), coordinator.enqueue(change === 'slot' ? commandSource : adapterSource)]);
    } else {
      await runtime.patchConfig([{ op: 'set', path: ['icqq', 'nickname'], value: 'After' },
        { op: 'set', path: ['icqq', 'profile'], value: afterProfile },
        ...(change === 'topology' ? [{ op: 'set' as const, path: ['plugins', 'extra'], value: '@test/extra' }] : []),
      ]);
    }
    const index = runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex;
    const commands = runtime.snapshot.projections.get(commandFeatureId) as CommandIndex;
    expect(await commands.execute('profile-view')).toBe(change === 'slot' ? 'After:updated' : 'After');
    expect(await oldCommands.execute('profile-view')).toBe('Before');
    expect(commands).not.toBe(oldCommands);
    expect(runtime.snapshot.config.get('root/icqq' as never)).toEqual({ nickname: 'After', profile: afterProfile });
    expect(previous.value.config.get('root/icqq' as never)).toEqual({ nickname: 'Before', profile: beforeProfile });
    expect(index.profile(id)!.peek().values).toEqual({ nickname: 'After', ...afterProfile });
    expect(oldPort.peek().values).toEqual({ nickname: 'Before', ...beforeProfile });
    const retainsTransport = declared && change !== 'adapter-slot';
    expect(index.clientById(id) === oldClient).toBe(retainsTransport);
    expect(transports.create).toBe(retainsTransport ? 1 : 2);
    expect(transports.connect).toBe(retainsTransport ? 1 : 2);
    expect(transports.setup).toBe(declared ? 1 : 2);
    if (retainsTransport) {
      expect(transports.stop).toBe(0);
      await expect(index.send(id, { conversation: { endpoint: { id, adapter: 'icqq' }, kind: 'private', id: 'recipient' }, payload: 'still connected' }))
        .resolves.toBe('profile-message');
    } else if (change === 'adapter-slot') {
      expect(runtime.configurationApplication.groups).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'plugins', effect: 'replace-resource', status: 'applied' }),
      ]));
      await expect(index.send(id, { conversation: { endpoint: { id, adapter: 'icqq' }, kind: 'private', id: 'recipient' }, payload: 'new implementation' }))
        .resolves.toBe('profile-message-v2');
    }
    previous.release(); previous = undefined;
  } finally {
    previous?.release();
    await coordinator?.stop();
    await runtime?.stop();
    await rm(project, { recursive: true, force: true });
  }
});

class ConfigPort implements ConfigDocumentPort {
  readonly sources: readonly string[];
  #revision = 0;
  document: RuntimeConfigDocument;
  constructor(source: string, document: RuntimeConfigDocument) { this.sources = [source]; this.document = structuredClone(document); }
  writeExternal(document: RuntimeConfigDocument) { this.document = structuredClone(document); this.#revision++; }
  async read(): Promise<ConfigDocumentSnapshot> { return { document: structuredClone(this.document), revision: String(this.#revision) }; }
  async prepare(current: ConfigDocumentSnapshot, patches: readonly ConfigPatch[]): Promise<PreparedConfigDocument> {
    const document = applyConfigPatches(current.document, patches);
    return { document, commit: async () => { this.writeExternal(document); return this.read(); }, rollback: async () => undefined };
  }
}

class Modules implements ModuleRuntime {
  readonly #values = new Map<string, unknown>();
  set(source: string, value: unknown) { this.#values.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.#values.has(source)) throw new Error(`Missing fixture module: ${source}`);
    return this.#values.get(source) as T;
  }
  invalidate() {}
  async close() {}
}
