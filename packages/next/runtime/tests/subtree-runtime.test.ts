import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createToken,
  definePlugin,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import commandFeature, {
  CommandIndex,
  commandFeatureId,
  defineCommand,
} from '@zhin.js/command';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Plugin subtree HMR', () => {
  it('replaces one subtree while retaining its ancestor and sibling lifetimes', async () => {
    const project = await createProject();
    const modules = new FakeModuleRuntime();
    const shared = createToken<string>('test.shared');
    const childValue = createToken<string>('test.child-value');
    const siblingValue = createToken<string>('test.sibling-value');
    const setupCalls = { root: 0, child: 0, sibling: 0 };
    const disposed: string[] = [];
    const handoffs: string[] = [];
    const rootSource = join(project, 'plugin.ts');
    const childSource = join(project, 'plugins/child/plugin.ts');
    const siblingSource = join(project, 'plugins/sibling/plugin.ts');
    const featureSource = join(project, 'packages/command/index.ts');

    modules.set(rootSource, {
      default: definePlugin({
        name: 'root',
        setup({ handoff }) {
          setupCalls.root += 1;
          handoff.add(recordHandoff('root'));
        },
      }),
    });
    modules.set(childSource, childPlugin('v1'));
    modules.set(siblingSource, {
      default: definePlugin({
        name: 'sibling',
        requires: [shared],
        setup({ resources, handoff }) {
          setupCalls.sibling += 1;
          resources.provide(siblingValue, 'sibling', () => { disposed.push('sibling'); });
          handoff.add(recordHandoff('sibling'));
        },
      }),
    });
    modules.set(featureSource, { default: commandFeature });
    modules.set(join(project, 'plugins/child/commands/status.ts'), {
      default: defineCommand({ execute: ({ use }) => use(childValue) }),
    });
    modules.set(join(project, 'plugins/sibling/commands/status.ts'), {
      default: defineCommand({ execute: ({ use }) => use(siblingValue) }),
    });

    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
      installResources({ resources }) {
        resources.provide(shared, 'shared', () => { disposed.push('root'); });
      },
    });
    const first = await runtime.start();
    const oldLease = runtime.controller.snapshots.acquire();
    await expect(commandIndex(first).execute('child status')).resolves.toBe('v1');
    expect(handoffs).toEqual([
      'root:activate',
      'child-v1:activate',
      'sibling:activate',
      'root:open',
      'child-v1:open',
      'sibling:open',
    ]);

    modules.set(childSource, childPlugin('v2'));
    const errors: unknown[] = [];
    const hmr = runtime.createHmrCoordinator({
      onRestartRequired() {},
      onError(error) { errors.push(error); },
    });
    await hmr.enqueue(childSource);
    const second = runtime.snapshot;

    expect(second.generation).toBe(2);
    await expect(commandIndex(second).execute('child status')).resolves.toBe('v2');
    await expect(commandIndex(second).execute('sibling status')).resolves.toBe('sibling');
    expect(setupCalls).toEqual({ root: 1, child: 2, sibling: 1 });
    expect(modules.loadCount(rootSource)).toBe(1);
    expect(modules.loadCount(siblingSource)).toBe(1);
    expect(disposed).toEqual([]);
    expect(handoffs.slice(6)).toEqual([
      'child-v2:quiesce:1',
      'child-v2:activate',
      'child-v2:open',
    ]);

    modules.set(childSource, {
      default: definePlugin({
        name: 'child-broken',
        setup({ resources }) {
          resources.provide(childValue, 'broken', () => { disposed.push('broken'); });
          throw new Error('child setup failed');
        },
      }),
    });
    await expect(hmr.enqueue(childSource)).rejects.toThrow('child setup failed');
    expect(runtime.snapshot).toBe(second);
    expect(disposed).toEqual(['broken']);
    await expect(commandIndex(runtime.snapshot).execute('child status')).resolves.toBe('v2');
    expect(errors).toHaveLength(1);

    oldLease.release();
    await waitForImmediate();
    expect(disposed).toEqual(['broken', 'child-v1']);

    await runtime.stop();
    expect(disposed).toEqual([
      'broken',
      'child-v1',
      'sibling',
      'child-v2',
      'root',
    ]);

    function childPlugin(version: string): { readonly default: unknown } {
      return {
        default: definePlugin({
          name: `child-${version}`,
          requires: [shared],
          setup({ resources, handoff }) {
            setupCalls.child += 1;
            resources.provide(childValue, version, () => {
              disposed.push(`child-${version}`);
            });
            handoff.add(recordHandoff(`child-${version}`));
          },
        }),
      };
    }

    function recordHandoff(name: string) {
      return {
        quiescePrevious(previous: RuntimeSnapshot) {
          handoffs.push(`${name}:quiesce:${previous.generation}`);
        },
        activateNext() { handoffs.push(`${name}:activate`); },
        deactivateNext() { handoffs.push(`${name}:deactivate`); },
        resumePrevious() { handoffs.push(`${name}:resume`); },
        openNext() { handoffs.push(`${name}:open`); },
      };
    }
  });
});

function commandIndex(snapshot: RuntimeSnapshot): CommandIndex {
  const index = snapshot.projections.get(commandFeatureId);
  if (!(index instanceof CommandIndex)) throw new Error('Missing Command projection');
  return index;
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    this.#loads.set(source, (this.#loads.get(source) ?? 0) + 1);
    return this.#modules.get(source) as T;
  }

  loadCount(source: string): number {
    return this.#loads.get(source) ?? 0;
  }

  affectedSources(source: string): readonly string[] {
    return [source];
  }

  invalidate(): void {}

  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-subtree-'));
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
  await pluginPackage(root, 'child', '@test/child');
  await pluginPackage(root, 'sibling', '@test/sibling');
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@test/command',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  for (const file of [
    'plugin.ts',
    'plugins/child/plugin.ts',
    'plugins/child/commands/status.ts',
    'plugins/sibling/plugin.ts',
    'plugins/sibling/commands/status.ts',
    'packages/command/index.ts',
  ]) await touch(join(root, file));
  return root;
}

async function pluginPackage(root: string, directory: string, name: string): Promise<void> {
  await writeJson(join(root, `plugins/${directory}/package.json`), {
    name,
    dependencies: { '@test/command': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [{ package: '@test/command' }],
    },
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
