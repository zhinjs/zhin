import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPluginConfigurationMap } from '@zhin.js/plugin-runtime';
import {
  APPLICATION_PLUGIN_RESERVED_KEYS,
  NodePackageResolver,
  ProjectGraphService,
  parsePackageJson,
  pluginInstanceConfigPath,
  readApplicationPluginDeclaration,
} from '../src/index.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true }))); });

describe('application Plugin declarations', () => {
  it('requires an explicit v2 application and rejects old and unknown formats with migration guidance', () => {
    for (const document of [{}, { plugins: {} }, { configVersion: 1 }, { configVersion: 3 }]) {
      expect(() => readApplicationPluginDeclaration(document)).toThrow('docs/migrations/plugin-instance-declarations.md');
    }
    expect(() => readPluginConfigurationMap({})).toThrow('configVersion must be 2');
  });

  it('separates package declarations, disabled intent and instance business values', () => {
    const document = {
      configVersion: 2,
      plugins: { home: '@test/reminder', work: '@test/reminder' },
      disable_plugins: ['home'], home: {}, work: { channel: 'work' },
    };
    expect(readApplicationPluginDeclaration(document)).toEqual({
      version: 2, disabled: ['home'], instances: [
        { instanceKey: 'home', package: '@test/reminder', enabled: false },
        { instanceKey: 'work', package: '@test/reminder', enabled: true },
      ],
    });
    expect(readPluginConfigurationMap(document)).toEqual({ home: {}, work: { channel: 'work' } });
    expect(pluginInstanceConfigPath(document, 'work')).toEqual(['work']);
  });

  it('uses source order for numeric aliases and refuses stale ordering metadata', () => {
    const document = { configVersion: 2, plugins: { '10': './plugins/a', '2': './plugins/a' } };
    expect(readApplicationPluginDeclaration(document, 'fixture', ['10', '2']).instances.map(item => item.instanceKey)).toEqual(['10', '2']);
    expect(() => readApplicationPluginDeclaration(document, 'fixture', ['10'])).toThrow('source order');
  });

  it('rejects collisions, orphan business blocks, invalid references and disabled aliases before package loading', () => {
    expect(APPLICATION_PLUGIN_RESERVED_KEYS).toEqual(expect.arrayContaining(['ai', 'database', 'plugin', 'constructor', 'plugins']));
    for (const key of ['ai', 'database', 'plugin', 'constructor', 'prototype']) {
      expect(() => readApplicationPluginDeclaration({ configVersion: 2, plugins: { [key]: '@test/x' } })).toThrow('reserved');
    }
    expect(readApplicationPluginDeclaration({ configVersion: 2, plugins: { root: '@test/x' } }).instances[0]?.instanceKey).toBe('root');
    for (const plugins of [null, [], { x: {} }, { x: './plugins/../escape' }, { x: './' }]) {
      expect(() => readApplicationPluginDeclaration({ configVersion: 2, plugins })).toThrow();
    }
    expect(() => readApplicationPluginDeclaration({ configVersion: 2, orphan: {} })).toThrow('undeclared');
    expect(() => readApplicationPluginDeclaration({ configVersion: 2, plugins: { x: '@test/x' }, x: null })).toThrow('business configuration object');
    expect(() => readApplicationPluginDeclaration({ configVersion: 2, disable_plugins: ['missing'] })).toThrow('undeclared');
    expect(() => readApplicationPluginDeclaration({ configVersion: 2, plugins: { x: '@test/x' }, disable_plugins: ['x', 'x'] })).toThrow('duplicate');
    expect(() => readApplicationPluginDeclaration({ configVersion: 2, plugins: { x: { package: '@test/x', optional: true } } })).toThrow();
  });

  it('builds only explicit root instances and does not resolve disabled missing packages', async () => {
    const root = await fixture({ name: '@test/root', dependencies: { '@test/child': 'workspace:*' } });
    await json(join(root, 'plugins/child/package.json'), {
      name: '@test/child', zhin: { ...plugin, plugins: [{ package: '@test/not-installed', instanceKey: 'hidden' }] },
    });
    const graph = await new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, {
      configVersion: 2,
      plugins: { first: '@test/child', second: '@test/child', missing: '@test/uninstalled' },
      disable_plugins: ['missing'], missing: { incomplete: true },
    });
    expect(graph.root.children.map(node => node.id)).toEqual(['root/first', 'root/second']);
    expect(graph.root.children.every(node => node.children.length === 0)).toBe(true);
    expect(graph.root.children[0]?.package).toBe(graph.root.children[1]?.package);
  });

  it('keeps platform Feature inheritance while ignoring facade instance defaults', async () => {
    const root = await fixture({ name: '@test/root', dependencies: { 'zhin.js': 'workspace:*' } });
    await json(join(root, 'packages/facade/package.json'), {
      name: 'zhin.js', dependencies: { '@zhin.js/core': 'workspace:*' },
      zhin: { ...plugin, plugins: [{ package: '@test/not-installed', instanceKey: 'implicit' }] },
    });
    await json(join(root, 'packages/core/package.json'), {
      name: '@zhin.js/core', dependencies: { '@test/feature': 'workspace:*' },
      zhin: { ...plugin, features: [{ package: '@test/feature', api: '^1.0.0' }] },
    });
    await json(join(root, 'packages/feature/package.json'), {
      name: '@test/feature', zhin: { protocol: 1, type: 'feature', entry: './provider.js', featureApi: '1.0.0' },
    });
    const graph = await new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, { configVersion: 2 });
    expect(graph.root.children).toEqual([]);
    expect(graph.root.features.map(item => item.package.name)).toEqual(['@test/feature']);
  });

  it('rejects old Root mounts and legacy disabled state instead of merging authorities', async () => {
    const root = await fixture({ name: '@test/root', zhin: { ...plugin, plugins: [{ package: '@test/child', instanceKey: 'child' }] } });
    await expect(new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, { configVersion: 2 }))
      .rejects.toThrow('docs/migrations/plugin-instance-declarations.md');
    await expect(new ProjectGraphService(await NodePackageResolver.create(root), { disabledPluginInstanceKeys: ['child'] })
      .inspect(root, { configVersion: 2 })).rejects.toThrow('disable_plugins');
  });

  it('validates only the two new static display metadata fields without changing the authoring contract', () => {
    const parsed = parsePackageJson({ name: '@test/plugin', zhin: { ...plugin, metadata: { displayName: 'Label', icon: 'Bell' } } }, 'fixture');
    expect(parsed.zhin).toMatchObject({ metadata: { displayName: 'Label', icon: 'Bell' } });
    expect(() => parsePackageJson({ name: '@test/plugin', zhin: { ...plugin, metadata: { order: 1 } } }, 'fixture')).toThrow('metadata.order');
  });
});

const plugin = { protocol: 1, type: 'plugin', entry: './plugin.ts' };
async function fixture(rootJson: Record<string, unknown>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-v2-declarations-')));
  temporary.push(root);
  await json(join(root, 'package.json'), { zhin: plugin, ...rootJson });
  return root;
}
async function json(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
