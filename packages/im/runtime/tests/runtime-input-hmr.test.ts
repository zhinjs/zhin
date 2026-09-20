import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  childPluginId,
  definePlugin,
  rootPluginId,
  type ConfigDocumentPort,
  type ConfigDocumentSnapshot,
  type ConfigPatch,
  type PreparedConfigDocument,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import {
  RootRuntime,
  type EnvironmentLayers,
  type EnvironmentLayersPort,
  type ModuleRuntime,
  type ProcessInvalidationPlan,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('RootRuntime watched inputs', () => {
  it('reloads only the Plugin subtree changed by an external config edit', async () => {
    const fixture = await createFixture({ plugins: { child: { label: 'one' } } });
    const installs = { resources: 0, root: 0, child: 0, sibling: 0 };
    fixture.modules.installSetups(installs);
    const runtime = new RootRuntime({
      projectRoot: fixture.root,
      modules: fixture.modules,
      config: fixture.config,
      environment: testEnvironment,
      installResources() { installs.resources += 1; },
    });
    await runtime.start();
    const coordinator = runtime.createHmrCoordinator({
      onRestartRequired() { throw new Error('unexpected process restart'); },
      onError(error) { throw error; },
    });

    fixture.config.writeExternal({ plugins: { child: { label: 'two' } } });
    await coordinator.enqueue(fixture.configSource);

    expect(runtime.snapshot.config.get(childPluginId(rootPluginId(), 'child')))
      .toEqual({ label: 'two' });
    expect(installs).toEqual({ resources: 1, root: 1, child: 2, sibling: 1 });
    await coordinator.stop();
    await runtime.stop();
  });

  it('requests a process restart when external config changes Host state', async () => {
    const fixture = await createFixture({ http: { port: 8080 } });
    fixture.modules.installSetups({ resources: 0, root: 0, child: 0, sibling: 0 });
    const runtime = new RootRuntime({
      projectRoot: fixture.root,
      modules: fixture.modules,
      config: fixture.config,
      environment: testEnvironment,
    });
    await runtime.start();
    const restarts: ProcessInvalidationPlan[] = [];
    const coordinator = runtime.createHmrCoordinator({
      onRestartRequired(plan) { restarts.push(plan); },
      onError(error) { throw error; },
    });

    fixture.config.writeExternal({ http: { port: 9090 } });
    await coordinator.enqueue(fixture.configSource);
    await vi.waitFor(() => expect(restarts).toHaveLength(1));

    expect(restarts[0]?.reasons).toEqual(['Host configuration changed: http']);
    expect(runtime.snapshot.generation).toBe(1);
    await coordinator.stop();
    await runtime.stop();
  });

  it('reloads dotenv layers and re-expands Plugin config references', async () => {
    const fixture = await createFixture({ plugins: { child: { label: '${LABEL}' } } });
    const environment = new FakeEnvironmentSource(
      join(fixture.root, '.env'),
      { base: { LABEL: 'one' } },
    );
    fixture.modules.installSetups({ resources: 0, root: 0, child: 0, sibling: 0 });
    const runtime = new RootRuntime({
      projectRoot: fixture.root,
      modules: fixture.modules,
      config: fixture.config,
      environment: testEnvironment,
      environmentSource: environment,
    });
    await runtime.start();
    const child = childPluginId(rootPluginId(), 'child');
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'one' });
    const coordinator = runtime.createHmrCoordinator({
      onRestartRequired() { throw new Error('unexpected process restart'); },
      onError(error) { throw error; },
    });

    environment.write({ base: { LABEL: 'two' } });
    await coordinator.enqueue(environment.sources[0]!);

    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'two' });
    await coordinator.stop();
    await runtime.stop();
  });

  it('keeps the previous environment snapshot when shadow setup rejects a reload', async () => {
    const fixture = await createFixture({ plugins: { child: { label: '${LABEL}' } } });
    const environment = new FakeEnvironmentSource(
      join(fixture.root, '.env'),
      { base: { LABEL: 'one' } },
    );
    fixture.modules.installSetups({ resources: 0, root: 0, child: 0, sibling: 0 });
    const runtime = new RootRuntime({
      projectRoot: fixture.root,
      modules: fixture.modules,
      config: fixture.config,
      environment: testEnvironment,
      environmentSource: environment,
    });
    await runtime.start();
    const child = childPluginId(rootPluginId(), 'child');
    const coordinator = runtime.createHmrCoordinator({
      onRestartRequired() { throw new Error('unexpected process restart'); },
      onError() {},
    });

    environment.write({ base: { LABEL: 'broken' } });
    await expect(coordinator.enqueue(environment.sources[0]!))
      .rejects.toThrow('child environment setup failed');
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'one' });

    environment.write({ base: { LABEL: 'two' } });
    await coordinator.enqueue(environment.sources[0]!);
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'two' });
    await coordinator.stop();
    await runtime.stop();
  });

  it('restarts the process when a dotenv change alters expanded Host config', async () => {
    const fixture = await createFixture({ http: { token: '${HTTP_TOKEN}' } });
    const environment = new FakeEnvironmentSource(
      join(fixture.root, '.env'),
      { base: { HTTP_TOKEN: 'one' } },
    );
    fixture.modules.installSetups({ resources: 0, root: 0, child: 0, sibling: 0 });
    const runtime = new RootRuntime({
      projectRoot: fixture.root,
      modules: fixture.modules,
      config: fixture.config,
      environment: testEnvironment,
      environmentSource: environment,
    });
    await runtime.start();
    const restarts: ProcessInvalidationPlan[] = [];
    const coordinator = runtime.createHmrCoordinator({
      onRestartRequired(plan) { restarts.push(plan); },
      onError(error) { throw error; },
    });

    environment.write({ base: { HTTP_TOKEN: 'two' } });
    await coordinator.enqueue(environment.sources[0]!);
    await vi.waitFor(() => expect(restarts).toHaveLength(1));

    expect(restarts[0]?.reasons).toEqual(['Host configuration changed: http']);
    await coordinator.stop();
    await runtime.stop();
  });
});

const testEnvironment = Object.freeze({ name: 'test', mode: 'test', platform: 'node' } as const);

class FakeConfigDocument implements ConfigDocumentPort {
  readonly sources: readonly string[];
  #document: RuntimeConfigDocument;
  #revision = 0;

  constructor(source: string, document: RuntimeConfigDocument) {
    this.sources = Object.freeze([source]);
    this.#document = structuredClone(document);
  }

  writeExternal(document: RuntimeConfigDocument): void {
    this.#document = structuredClone(document);
    this.#revision += 1;
  }

  async read(): Promise<ConfigDocumentSnapshot> {
    return Object.freeze({
      document: structuredClone(this.#document),
      revision: `r${this.#revision}`,
    });
  }

  async prepare(
    _current: ConfigDocumentSnapshot,
    _patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument> {
    throw new Error('not used by watched-input tests');
  }
}

class FakeEnvironmentSource implements EnvironmentLayersPort {
  readonly sources: readonly string[];
  #layers: EnvironmentLayers;

  constructor(source: string, layers: EnvironmentLayers) {
    this.sources = Object.freeze([source]);
    this.#layers = structuredClone(layers);
  }

  write(layers: EnvironmentLayers): void {
    this.#layers = structuredClone(layers);
  }

  async read(): Promise<EnvironmentLayers> {
    return structuredClone(this.#layers);
  }
}

class FakeModules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();

  constructor(private readonly root: string) {}

  installSetups(counts: { root: number; child: number; sibling: number }): void {
    this.#modules.set(join(this.root, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() { counts.root += 1; } }),
    });
    for (const name of ['child', 'sibling'] as const) {
      this.#modules.set(join(this.root, `plugins/${name}/plugin.ts`), {
        default: definePlugin({
          name,
          setup({ config }) {
            if (name === 'child' && (config.get() as { label?: string }).label === 'broken') {
              throw new Error('child environment setup failed');
            }
            counts[name] += 1;
          },
        }),
      });
    }
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }

  requiresProcessRestart(source: string): boolean {
    return source.endsWith('.env');
  }

  invalidate(): void {}
  async close(): Promise<void> {}
}

async function createFixture(document: RuntimeConfigDocument): Promise<{
  readonly root: string;
  readonly configSource: string;
  readonly config: FakeConfigDocument;
  readonly modules: FakeModules;
}> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-input-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/child': 'workspace:*', '@test/sibling': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [
        { package: '@test/child', instanceKey: 'child' },
        { package: '@test/sibling', instanceKey: 'sibling' },
      ],
    },
  });
  await writeSchema(join(root, 'schema.json'), 'mode', 'development');
  await pluginPackage(root, 'child', '@test/child', 'child');
  await pluginPackage(root, 'sibling', '@test/sibling', 'sibling');
  for (const file of ['plugin.ts', 'plugins/child/plugin.ts', 'plugins/sibling/plugin.ts']) {
    await touch(join(root, file));
  }
  const canonicalRoot = await realpath(root);
  const configSource = join(canonicalRoot, 'zhin.config.yml');
  return {
    root: canonicalRoot,
    configSource,
    config: new FakeConfigDocument(configSource, document),
    modules: new FakeModules(canonicalRoot),
  };
}

async function pluginPackage(
  root: string,
  directory: string,
  name: string,
  defaultLabel: string,
): Promise<void> {
  await writeJson(join(root, `plugins/${directory}/package.json`), {
    name,
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  });
  await writeSchema(join(root, `plugins/${directory}/schema.json`), 'label', defaultLabel);
}

async function writeSchema(
  path: string,
  property: string,
  defaultValue: string,
): Promise<void> {
  await writeJson(path, {
    type: 'object',
    additionalProperties: false,
    properties: { [property]: { type: 'string', default: defaultValue } },
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
