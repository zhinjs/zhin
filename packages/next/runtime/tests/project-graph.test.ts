import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ManifestValidationError,
  NodePackageResolver,
  PackageResolutionError,
  ProjectGraphService,
  parsePackageJson,
} from '../src/index.js';

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
});

interface ProjectInput {
  readonly root: unknown;
  readonly features?: readonly { directory: string; json: unknown }[];
  readonly plugins?: readonly { directory: string; json: unknown }[];
}

async function project(input: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-'));
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
