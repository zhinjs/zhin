import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { childPluginId, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import {
  deriveEntrylessPluginName,
  EntrylessPluginNameError,
  ManifestValidationError,
  NodePackageResolver,
  parsePackageJson,
  RootRuntime,
  type ModuleRuntime,
} from '../src/index.js';
import { NodeIsolatedPluginRuntime } from '../src/isolate/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('entry-less Plugin manifest', () => {
  it('records no entry when a Plugin declares neither zhin.entry nor exports["./zhin"]', () => {
    const parsed = parsePackageJson({ name: '@acme/demo', zhin: { protocol: 1, type: 'plugin' } }, 'package.json');
    expect(parsed.zhin.type).toBe('plugin');
    expect(parsed.zhin.entry).toBeUndefined();
    expect('entry' in parsed.zhin).toBe(false);
  });

  it('keeps requiring an entry for Feature packages and validating a declared Plugin entry', () => {
    expect(() => parsePackageJson({ name: 'x', zhin: { protocol: 1, type: 'feature' } }, 'package.json'))
      .toThrow(ManifestValidationError);
    expect(() => parsePackageJson({ name: 'x', zhin: { protocol: 1, type: 'plugin', entry: 'plugin.ts' } }, 'package.json'))
      .toThrow('package.json#zhin.entry must be a package-relative path starting with ./');
  });

  it('resolves an entry-less package without inventing an entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-entryless-resolve-'));
    temporary.push(root);
    await writeJson(join(root, 'package.json'), { name: 'demo', zhin: { protocol: 1, type: 'plugin' } });
    await touch(join(root, 'plugin.ts'));
    const resolved = await (await NodePackageResolver.create(root)).root(root);
    expect(resolved.packageJson.zhin.entry).toBeUndefined();
  });
});

describe('entry-less Plugin name derivation', () => {
  it('uses the unscoped package name without stripping other prefixes', () => {
    expect(deriveEntrylessPluginName('@acme/demo')).toBe('demo');
    expect(deriveEntrylessPluginName('demo')).toBe('demo');
    expect(deriveEntrylessPluginName('zhin-plugin-demo')).toBe('zhin-plugin-demo');
  });

  it('rejects a derived name that breaks the Plugin name rule and points at plugin.ts', () => {
    for (const name of ['zhin.js-demo', '@acme/1demo', 'Demo', '@acme/demo_x']) {
      expect(() => deriveEntrylessPluginName(name)).toThrow(EntrylessPluginNameError);
    }
    expect(() => deriveEntrylessPluginName('zhin.js-demo')).toThrow(/Add a plugin\.ts .*explicit name/);
  });
});

describe('entry-less Plugin assembly', () => {
  it('assembles a root Plugin without plugin.ts and discovers its convention commands from the package root', async () => {
    const project = await createProject({ name: '@acme/demo', metadata: { displayName: 'Demo' } });
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/demo/index.ts'), { default: defineCommand({ execute: () => 'demo ok' }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    try {
      await runtime.start();
      expect(await commandIndex(runtime.snapshot).execute('demo')).toBe('demo ok');
      const node = runtime.snapshot.tree.get(rootPluginId());
      expect(node?.metadata).toEqual({ displayName: 'Demo' });
      expect(node?.capabilityGraph?.features?.commands).toEqual(['demo']);
      expect(modules.loaded).not.toContain(join(project, 'plugin.ts'));
    } finally { await runtime.stop(); }
  });

  it('fails with a clear message when the package name cannot be a Plugin name', async () => {
    const project = await createProject({ name: 'zhin.js-demo' });
    const modules = new FakeModuleRuntime();
    modules.set(join(project, 'packages/command/index.ts'), { default: commandFeature });
    modules.set(join(project, 'commands/demo/index.ts'), { default: defineCommand({ execute: () => 'demo ok' }) });
    const runtime = new RootRuntime({ projectRoot: project, modules, config: { configVersion: 2, plugins: {} },
      environment: { name: 'test', mode: 'test', platform: 'node' } });
    await expect(runtime.start()).rejects.toThrow(/zhin\.js-demo.*not a valid Plugin name.*plugin\.ts/s);
  });
});

describe('entry-less isolated Plugin', () => {
  it('prepares and activates an isolated Plugin from its derived name without importing an entry', async () => {
    const runtime = new NodeIsolatedPluginRuntime({ mode: 'worker' });
    const owner = childPluginId(rootPluginId(), 'child');
    const prepared = await runtime.prepare({ owner, parent: rootPluginId(), packageName: '@test/child', entrylessName: 'child',
      config: {}, environment: { name: 'test', mode: 'test', platform: 'node' } }, new AbortController().signal);
    try {
      expect(prepared.descriptor.name).toBe('child');
      await prepared.handoff?.activateNext?.(new AbortController().signal);
    } finally { await prepared.dispose(); }
  });

  it('still rejects an isolated prepare that carries neither an entry nor a derived name', async () => {
    const runtime = new NodeIsolatedPluginRuntime({ mode: 'worker' });
    const owner = childPluginId(rootPluginId(), 'child');
    await expect(runtime.prepare({ owner, parent: rootPluginId(), packageName: '@test/child',
      config: {}, environment: { name: 'test', mode: 'test', platform: 'node' } }, new AbortController().signal))
      .rejects.toThrow('@test/child does not default-export a Plugin definition');
  });
});

function commandIndex(snapshot: RuntimeSnapshot): CommandIndex {
  const index = snapshot.projections.get(commandFeatureId);
  if (!(index instanceof CommandIndex)) throw new Error('Missing Command projection');
  return index;
}

class FakeModuleRuntime implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly loaded: string[] = [];

  set(source: string, value: unknown): void {
    this.#modules.set(source, value);
  }

  async load<T>(source: string): Promise<T> {
    this.loaded.push(source);
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    return this.#modules.get(source) as T;
  }

  affectedSources(source: string): readonly string[] {
    return [source];
  }

  invalidate(): void {}

  async close(): Promise<void> {}
}

async function createProject(options: { name: string; metadata?: Record<string, string> }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-entryless-plugin-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), {
    name: options.name,
    dependencies: { '@test/command': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      ...(options.metadata ? { metadata: options.metadata } : {}),
      features: [{ package: '@test/command' }],
    },
  });
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@test/command',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
  });
  await touch(join(root, 'packages/command/index.ts'));
  await touch(join(root, 'commands/demo/index.ts'));
  return realpath(root);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
}
