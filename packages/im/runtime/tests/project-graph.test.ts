import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ManifestValidationError,
  NodePackageResolver,
  PackageCompatibilityError,
  PackageResolutionError,
  ProjectGraphService,
  parsePackageJson,
} from '../src/index.js';

async function realpathResolved(path: string): Promise<string> {
  return realpath(path);
}

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('static Project Graph', () => {
  it('keeps the flat package graph separate from the recursive Plugin tree', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        dependencies: {
          '@test/command': 'workspace:*',
          '@test/child': 'workspace:*',
        },
        zhin: {
          protocol: 1,
          type: 'plugin',
          entry: './plugin.ts',
          features: [{ package: '@test/command' }],
          plugins: [{ package: '@test/child', instanceKey: 'child' }],
        },
      },
      features: [{
        directory: 'command',
        json: {
          name: '@test/command',
          zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
        },
      }],
      plugins: [{
        directory: 'child',
        json: {
          name: '@test/child',
          zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
        },
      }],
    });

    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    expect(graph.root.children[0]?.id).toBe('root/child');
    expect(graph.root.features[0]?.package.name).toBe('@test/command');
    expect(graph.buildOrder.map((pkg) => pkg.name)).toEqual([
      '@test/command',
      '@test/child',
      '@test/root',
    ]);
  });

  it('rejects a manifest reference that is not a package dependency', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        zhin: {
          protocol: 1,
          type: 'plugin',
          entry: './plugin.ts',
          plugins: [{ package: '@test/child', instanceKey: 'child' }],
        },
      },
      plugins: [{
        directory: 'child',
        json: {
          name: '@test/child',
          zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
        },
      }],
    });
    const resolver = await NodePackageResolver.create(root);

    await expect(new ProjectGraphService(resolver).inspect(root)).rejects.toBeInstanceOf(
      PackageResolutionError,
    );
  });

  it('rejects nested workspace roots', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
      },
      plugins: [{
        directory: 'child',
        json: {
          name: '@test/child',
          zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
        },
      }],
    });
    await writeFile(join(root, 'plugins/child/pnpm-workspace.yaml'), 'packages: []\n');

    await expect(NodePackageResolver.create(root)).rejects.toThrow('Nested workspace');
  });

  it('reports all scalar manifest validation errors together', () => {
    expect(() => parsePackageJson({
      name: '@test/root',
      private: 'yes',
      dependencies: { child: 1 },
      zhin: { protocol: 2, type: 'plugin', entry: '../plugin.ts' },
    }, '/project/package.json')).toThrow(ManifestValidationError);

    try {
      parsePackageJson({
        name: '@test/root',
        private: 'yes',
        dependencies: { child: 1 },
        zhin: { protocol: 2, type: 'plugin', entry: '../plugin.ts' },
      }, '/project/package.json');
    } catch (error) {
      expect((error as ManifestValidationError).issues).toHaveLength(4);
    }
  });

  it('rejects package references that could escape node_modules resolution', () => {
    expect(() => parsePackageJson({
      name: '@test/root',
      dependencies: { '../outside': '1.0.0' },
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
        plugins: [{ package: '../outside', instanceKey: 'outside' }],
      },
    }, '/project/package.json')).toThrow(ManifestValidationError);
  });

  it('rejects incompatible engine ranges before runtime module loading', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^2.0.0' },
      },
    });
    const resolver = await NodePackageResolver.create(root);

    await expect(new ProjectGraphService(resolver).inspect(root))
      .rejects.toMatchObject({
        name: 'PackageCompatibilityError',
        contract: 'engine',
        packageName: '@test/root',
      } satisfies Partial<PackageCompatibilityError>);
  });

  it('inherits features from @zhin.js/core when Root depends on it directly', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        dependencies: {
          '@zhin.js/core': 'workspace:*',
        },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
      },
      features: [
        {
          directory: 'core',
          json: {
            name: '@zhin.js/core',
            dependencies: {
              '@zhin.js/adapter': 'workspace:*',
              '@zhin.js/command': 'workspace:*',
              '@zhin.js/component': 'workspace:*',
              '@zhin.js/middleware': 'workspace:*',
            },
            zhin: {
              protocol: 1,
              type: 'plugin',
              entry: './index.ts',
              features: [
                { package: '@zhin.js/adapter', api: '^1.0.0' },
                { package: '@zhin.js/command', api: '^1.0.0' },
                { package: '@zhin.js/component', api: '^1.0.0' },
                { package: '@zhin.js/middleware', api: '^1.0.0' },
              ],
            },
          },
        },
        {
          directory: 'adapter',
          json: {
            name: '@zhin.js/adapter',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
        {
          directory: 'command',
          json: {
            name: '@zhin.js/command',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
        {
          directory: 'component',
          json: {
            name: '@zhin.js/component',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
        {
          directory: 'middleware',
          json: {
            name: '@zhin.js/middleware',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
      ],
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    expect(graph.root.features.map((item) => item.package.name).sort()).toEqual([
      '@zhin.js/adapter',
      '@zhin.js/command',
      '@zhin.js/component',
      '@zhin.js/middleware',
    ]);
  });

  it('inherits @zhin.js/core features via the zhin.js facade dependency', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        dependencies: {
          'zhin.js': 'workspace:*',
        },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
      },
      features: [
        {
          directory: 'zhin-js',
          json: {
            name: 'zhin.js',
            dependencies: {
              '@zhin.js/core': 'workspace:*',
            },
            zhin: {
              protocol: 1,
              type: 'plugin',
              entry: './index.ts',
              features: [],
            },
          },
        },
        {
          directory: 'core',
          json: {
            name: '@zhin.js/core',
            dependencies: {
              '@zhin.js/adapter': 'workspace:*',
              '@zhin.js/command': 'workspace:*',
              '@zhin.js/component': 'workspace:*',
            },
            zhin: {
              protocol: 1,
              type: 'plugin',
              entry: './index.ts',
              features: [
                { package: '@zhin.js/adapter', api: '^1.0.0' },
                { package: '@zhin.js/command', api: '^1.0.0' },
                { package: '@zhin.js/component', api: '^1.0.0' },
              ],
            },
          },
        },
        {
          directory: 'adapter',
          json: {
            name: '@zhin.js/adapter',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
        {
          directory: 'command',
          json: {
            name: '@zhin.js/command',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
        {
          directory: 'component',
          json: {
            name: '@zhin.js/component',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
      ],
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    expect(graph.root.features.map((item) => item.package.name).sort()).toEqual([
      '@zhin.js/adapter',
      '@zhin.js/command',
      '@zhin.js/component',
    ]);
  });

  it('skips platform feature inheritance when platformFeatures is false', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        dependencies: { '@zhin.js/core': 'workspace:*' },
        zhin: {
          protocol: 1,
          type: 'plugin',
          entry: './plugin.ts',
          platformFeatures: false,
        },
      },
      features: [{
        directory: 'core',
        json: {
          name: '@zhin.js/core',
          dependencies: { '@zhin.js/command': 'workspace:*' },
          zhin: {
            protocol: 1,
            type: 'plugin',
            entry: './index.ts',
            features: [{ package: '@zhin.js/command', api: '^1.0.0' }],
          },
        },
      }, {
        directory: 'command',
        json: {
          name: '@zhin.js/command',
          zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
        },
      }],
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);
    expect(graph.root.features).toEqual([]);
  });

  it('lets an explicit Feature dependency override the @zhin.js/core carrier location', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        dependencies: {
          '@zhin.js/core': 'workspace:*',
          '@zhin.js/command': 'workspace:*',
        },
        zhin: {
          protocol: 1,
          type: 'plugin',
          entry: './plugin.ts',
          features: [{ package: '@zhin.js/command', api: '^1.0.0' }],
        },
      },
      features: [
        {
          directory: 'core',
          json: {
            name: '@zhin.js/core',
            dependencies: {
              '@zhin.js/adapter': 'workspace:*',
              '@zhin.js/command': 'workspace:*',
            },
            zhin: {
              protocol: 1,
              type: 'plugin',
              entry: './index.ts',
              features: [
                { package: '@zhin.js/adapter', api: '^1.0.0' },
                { package: '@zhin.js/command', api: '^1.0.0' },
              ],
            },
          },
        },
        {
          directory: 'adapter',
          json: {
            name: '@zhin.js/adapter',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
        {
          directory: 'command',
          json: {
            name: '@zhin.js/command',
            zhin: {
              protocol: 1,
              type: 'feature',
              entry: './index.ts',
              featureApi: '1.0.0',
            },
          },
        },
      ],
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    const command = graph.root.features.find((item) => item.package.name === '@zhin.js/command');
    expect(command?.package.root).toBe(await realpathResolved(join(root, 'packages/command')));
    expect(graph.root.features.map((item) => item.package.name).sort()).toEqual([
      '@zhin.js/adapter',
      '@zhin.js/command',
    ]);
  });

  it('inherits host child plugins declared on the zhin.js facade', async () => {
    const root = await project({
      root: {
        name: '@test/root',
        dependencies: { 'zhin.js': 'workspace:*' },
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
      },
      features: [
        {
          directory: 'zhin-js',
          json: {
            name: 'zhin.js',
            dependencies: {
              '@zhin.js/core': 'workspace:*',
              '@zhin.js/host-router': 'workspace:*',
              '@zhin.js/host-api': 'workspace:*',
            },
            zhin: {
              protocol: 1,
              type: 'plugin',
              entry: './index.ts',
              features: [],
              plugins: [
                { package: '@zhin.js/host-router', instanceKey: 'router' },
                { package: '@zhin.js/host-api', instanceKey: 'host' },
              ],
            },
          },
        },
        {
          directory: 'core',
          json: {
            name: '@zhin.js/core',
            dependencies: { '@zhin.js/command': 'workspace:*' },
            zhin: {
              protocol: 1,
              type: 'plugin',
              entry: './index.ts',
              features: [{ package: '@zhin.js/command', api: '^1.0.0' }],
            },
          },
        },
        {
          directory: 'command',
          json: {
            name: '@zhin.js/command',
            zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
          },
        },
        {
          directory: 'host-router',
          json: {
            name: '@zhin.js/host-router',
            zhin: { protocol: 1, type: 'plugin', entry: './index.ts' },
          },
        },
        {
          directory: 'host-api',
          json: {
            name: '@zhin.js/host-api',
            zhin: { protocol: 1, type: 'plugin', entry: './index.ts' },
          },
        },
      ],
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    expect(graph.root.children.map((item) => item.instanceKey).sort()).toEqual(['host', 'router']);
    expect(graph.root.features.map((item) => item.package.name)).toEqual(['@zhin.js/command']);
  });

  it('validates Feature API requirements against provider manifests', async () => {
    const compatible = await project({
      root: {
        name: '@test/root',
        dependencies: { '@test/command': 'workspace:*' },
        zhin: {
          protocol: 1,
          type: 'plugin',
          entry: './plugin.ts',
          features: [{ package: '@test/command', api: '^1.2.0' }],
        },
      },
      features: [{
        directory: 'command',
        json: {
          name: '@test/command',
          zhin: {
            protocol: 1,
            type: 'feature',
            entry: './index.ts',
            featureApi: '1.4.0',
          },
        },
      }],
    });
    const compatibleResolver = await NodePackageResolver.create(compatible);
    await expect(new ProjectGraphService(compatibleResolver).inspect(compatible)).resolves
      .toEqual(expect.objectContaining({ root: expect.any(Object) }));

    const incompatible = await project({
      root: {
        name: '@test/root',
        dependencies: { '@test/command': 'workspace:*' },
        zhin: {
          protocol: 1,
          type: 'plugin',
          entry: './plugin.ts',
          features: [{ package: '@test/command', api: '^2.0.0' }],
        },
      },
      features: [{
        directory: 'command',
        json: {
          name: '@test/command',
          zhin: {
            protocol: 1,
            type: 'feature',
            entry: './index.ts',
            featureApi: '1.4.0',
          },
        },
      }],
    });
    const incompatibleResolver = await NodePackageResolver.create(incompatible);
    await expect(new ProjectGraphService(incompatibleResolver).inspect(incompatible))
      .rejects.toThrow('@test/root requires ^2.0.0, provider declares 1.4.0');
  });
});

interface ProjectInput {
  readonly root: unknown;
  readonly features?: readonly { directory: string; json: unknown }[];
  readonly plugins?: readonly { directory: string; json: unknown }[];
}

async function project(input: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-'));
  temporary.push(root);
  await writeJson(join(root, 'package.json'), input.root);
  for (const feature of input.features ?? []) {
    await writeJson(join(root, 'packages', feature.directory, 'package.json'), feature.json);
  }
  for (const plugin of input.plugins ?? []) {
    await writeJson(join(root, 'plugins', plugin.directory, 'package.json'), plugin.json);
  }
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
