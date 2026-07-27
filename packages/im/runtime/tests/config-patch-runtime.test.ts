import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  childPluginId,
  definePlugin,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import {
  ConfigDocumentDivergenceError,
  ConfigValidationError,
  RootRuntime,
  type ConfigDocumentPort,
  type ConfigDocumentSnapshot,
  type ConfigPatch,
  type ModuleRuntime,
  type PreparedConfigDocument,
  type RuntimeConfigDocument,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('RootRuntime config patches', () => {
  it('validates and atomically replaces only the shallowest changed Plugin forests', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const setupCalls = { root: 0, child: 0, sibling: 0 };
    const observed = { root: [] as unknown[], child: [] as unknown[], sibling: [] as unknown[] };
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({
        name: 'root',
        setup({ config }) {
          setupCalls.root += 1;
          observed.root.push(config.get());
        },
      }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({
        name: 'child',
        setup({ config }) {
          const value = config.get() as { readonly label: string };
          if (value.label === 'broken') throw new Error('child config setup failed');
          setupCalls.child += 1;
          observed.child.push(value);
        },
      }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({
        name: 'sibling',
        setup({ config }) {
          setupCalls.sibling += 1;
          observed.sibling.push(config.get());
        },
      }),
    });

    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    await runtime.start();
    const child = childPluginId(rootPluginId(), 'child');
    const sibling = childPluginId(rootPluginId(), 'sibling');

    const childUpdate = await runtime.patchConfig([{
      op: 'set',
      path: ['plugins', 'child', 'label'],
      value: 'v2',
    }]);
    expect(childUpdate.generation).toBe(2);
    expect(childUpdate.config.get(child)).toEqual({ label: 'v2' });
    expect(setupCalls).toEqual({ root: 1, child: 2, sibling: 1 });
    expect(observed.child).toEqual([{ label: 'v1' }, { label: 'v2' }]);

    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['plugins', 'child', 'label'],
      value: 42,
    }])).rejects.toBeInstanceOf(ConfigValidationError);
    expect(runtime.snapshot).toBe(childUpdate);
    expect(setupCalls).toEqual({ root: 1, child: 2, sibling: 1 });

    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['plugins', 'child', 'label'],
      value: 'broken',
    }])).rejects.toThrow('child config setup failed');
    expect(runtime.snapshot).toBe(childUpdate);
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'v2' });
    expect(setupCalls).toEqual({ root: 1, child: 2, sibling: 1 });

    const noChange = await runtime.patchConfig([{
      op: 'set',
      path: ['plugins', 'child', 'label'],
      value: 'v2',
    }]);
    expect(noChange).toBe(childUpdate);

    await Promise.all([
      runtime.patchConfig([{
        op: 'set',
        path: ['plugins', 'child', 'label'],
        value: 'v3',
      }]),
      runtime.patchConfig([{
        op: 'set',
        path: ['plugins', 'sibling', 'label'],
        value: 's2',
      }]),
    ]);
    expect(runtime.snapshot.generation).toBe(4);
    expect(runtime.snapshot.config.get(child)).toEqual({ label: 'v3' });
    expect(runtime.snapshot.config.get(sibling)).toEqual({ label: 's2' });
    expect(setupCalls).toEqual({ root: 1, child: 3, sibling: 2 });

    await runtime.patchConfig([{
      op: 'set',
      path: ['plugin', 'mode'],
      value: 'production',
    }]);
    expect(runtime.snapshot.generation).toBe(5);
    expect(runtime.snapshot.config.get(rootPluginId())).toEqual({ mode: 'production' });
    expect(setupCalls).toEqual({ root: 2, child: 4, sibling: 3 });

    await runtime.stop();
  });

  it('rebuilds the full generation for host-level patches when an installer exists', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() {} }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({ name: 'child', setup() {} }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({ name: 'sibling', setup() {} }),
    });
    const installed: unknown[] = [];
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources: ({ config }) => {
        installed.push(structuredClone(config.document));
      },
    });
    const started = await runtime.start();
    expect(installed).toHaveLength(1);

    // http never lands in a Plugin ConfigView, so the patch plans zero roots;
    // the Root Resource installer must still be rebuilt on the new document.
    const patched = await runtime.patchConfig([{
      op: 'set',
      path: ['http', 'port'],
      value: 8080,
    }]);
    expect(patched.generation).toBe(started.generation + 1);
    expect(installed).toHaveLength(2);
    expect(installed[1]).toMatchObject({ http: { port: 8080 } });

    await runtime.stop();
  });

  it('keeps the commit-only shortcut for host-level patches without an installer', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() {} }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({ name: 'child', setup() {} }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({ name: 'sibling', setup() {} }),
    });
    const port = new FakeConfigDocumentPort({});
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: port,
    });
    const started = await runtime.start();

    const patched = await runtime.patchConfig([{
      op: 'set',
      path: ['http', 'port'],
      value: 8080,
    }]);
    expect(patched).toBe(started);
    expect(port.commits).toBe(1);
    expect(port.rollbacks).toBe(0);
    expect(port.document).toEqual({ http: { port: 8080 } });

    await runtime.stop();
  });

  it('rolls back a prepared document transaction when the shadow phase fails', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'plugin.ts'), {
      default: definePlugin({ name: 'root', setup() {} }),
    });
    modules.set(join(project, 'plugins/child/plugin.ts'), {
      default: definePlugin({
        name: 'child',
        setup({ config }) {
          if ((config.get() as { readonly label: string }).label === 'broken') {
            throw new Error('child config setup failed');
          }
        },
      }),
    });
    modules.set(join(project, 'plugins/sibling/plugin.ts'), {
      default: definePlugin({ name: 'sibling', setup() {} }),
    });
    const port = new FakeConfigDocumentPort({});
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: port,
    });
    const started = await runtime.start();

    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['plugins', 'child', 'label'],
      value: 'broken',
    }])).rejects.toThrow('child config setup failed');
    expect(runtime.snapshot).toBe(started);
    expect(port.commits).toBe(0);
    expect(port.rollbacks).toBe(1);
    expect(port.document).toEqual({});

    port.diverge = true;
    await expect(runtime.patchConfig([{
      op: 'set',
      path: ['plugins', 'child', 'label'],
      value: 'v2',
    }])).rejects.toBeInstanceOf(ConfigDocumentDivergenceError);
    expect(runtime.snapshot).toBe(started);
    expect(port.commits).toBe(0);
    expect(port.rollbacks).toBe(2);
    expect(port.document).toEqual({});

    await runtime.stop();
  });
});

class FakeConfigDocumentPort implements ConfigDocumentPort {
  commits = 0;
  rollbacks = 0;
  diverge = false;
  #document: RuntimeConfigDocument;

  constructor(document: RuntimeConfigDocument) {
    this.#document = structuredClone(document);
  }

  get document(): RuntimeConfigDocument {
    return this.#document;
  }

  async read(): Promise<ConfigDocumentSnapshot> {
    return { document: structuredClone(this.#document), revision: `r${this.commits}` };
  }

  async prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument> {
    const document = structuredClone(current.document) as Record<string, unknown>;
    if (this.diverge) document.diverged = true;
    else {
      for (const patch of patches) {
        if (patch.op !== 'set') continue;
        let target = document;
        for (const segment of patch.path.slice(0, -1)) {
          target = (target[segment] ??= {}) as Record<string, unknown>;
        }
        target[patch.path[patch.path.length - 1]!] = structuredClone(patch.value);
      }
    }
    return {
      document,
      commit: async () => {
        this.commits += 1;
        this.#document = structuredClone(document);
        return { document, revision: `r${this.commits}` };
      },
      rollback: async () => {
        this.rollbacks += 1;
      },
    };
  }
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }

  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-config-patch-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: {
      '@test/child': 'workspace:*',
      '@test/sibling': 'workspace:*',
    },
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
  await pluginPackage(root, 'child', '@test/child', 'v1');
  await pluginPackage(root, 'sibling', '@test/sibling', 's1');
  for (const file of [
    'plugin.ts',
    'plugins/child/plugin.ts',
    'plugins/sibling/plugin.ts',
  ]) await touch(join(root, file));
  return realpath(root);
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
