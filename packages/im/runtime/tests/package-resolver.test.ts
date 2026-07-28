import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NodePackageResolver,
  PackageResolutionError,
  ProjectGraphService,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

const pluginManifest = { protocol: 1, type: 'plugin', entry: './plugin.ts' } as const;
const featureManifest = { protocol: 1, type: 'feature', entry: './index.ts' } as const;

async function fixture(files: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-resolver-'));
  temporary.push(root);
  for (const [path, value] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

describe('NodePackageResolver 解析规则矩阵', () => {
  it('local：./ 路径相对声明包根解析，跳过依赖声明检查', async () => {
    // 注意：取扫描面（packages/*、plugins/* 顶层）之外的目录——扫描面内的包
    // 已被 workspace 登记并缓存，source 为 workspace（见 project-graph.test.ts）。
    const root = await fixture({
      'package.json': { name: '@test/root', zhin: pluginManifest },
      'modules/greeter/package.json': { name: 'greeter', zhin: pluginManifest },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    const resolved = await resolver.resolve('./modules/greeter', from);

    expect(resolved.name).toBe('greeter');
    expect(resolved.source).toBe('local');
    expect(resolved.root).toBe(await realpath(join(root, 'modules/greeter')));
  });

  it('local：目录缺失时抛 PackageResolutionError', async () => {
    const root = await fixture({
      'package.json': { name: '@test/root', zhin: pluginManifest },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    await expect(resolver.resolve('./plugins/missing', from))
      .rejects.toBeInstanceOf(PackageResolutionError);
    await expect(resolver.resolve('./plugins/missing', from))
      .rejects.toThrow('Cannot resolve ./plugins/missing from @test/root');
  });

  it('workspace：byName 命中扫描结果，优先于 node_modules', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        dependencies: { '@test/lib': 'workspace:*' },
        zhin: pluginManifest,
      },
      'packages/lib/package.json': { name: '@test/lib', zhin: featureManifest },
      'node_modules/@test/lib/package.json': { name: '@test/lib', zhin: featureManifest },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    const resolved = await resolver.resolve('@test/lib', from);

    expect(resolved.source).toBe('workspace');
    expect(resolved.root).toBe(await realpath(join(root, 'packages/lib')));
  });

  it('node_modules：从声明包根逐级上溯查找', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        dependencies: { '@test/child': 'workspace:*' },
        zhin: pluginManifest,
      },
      'packages/child/package.json': {
        name: '@test/child',
        dependencies: { '@test/lib': '^1.0.0' },
        zhin: pluginManifest,
      },
      // 只装在项目根 node_modules，从 packages/child 出发需上溯两级
      'node_modules/@test/lib/package.json': { name: '@test/lib', zhin: featureManifest },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);
    const child = await resolver.resolve('@test/child', from);

    const resolved = await resolver.resolve('@test/lib', child);

    expect(resolved.source).toBe('node_modules');
    expect(resolved.root).toBe(await realpath(join(root, 'node_modules/@test/lib')));
  });

  it('node_modules：未声明的引用直接拒绝，即使包已安装', async () => {
    const root = await fixture({
      'package.json': { name: '@test/root', zhin: pluginManifest },
      'node_modules/@test/lib/package.json': { name: '@test/lib', zhin: featureManifest },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    await expect(resolver.resolve('@test/lib', from))
      .rejects.toThrow('does not declare it as a package dependency');
  });

  it('peer：仅在 peerDependencies 声明的宽松引用也可解析', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        peerDependencies: { '@test/lib': '^1.0.0' },
        zhin: pluginManifest,
      },
      'node_modules/@test/lib/package.json': { name: '@test/lib', zhin: featureManifest },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    const resolved = await resolver.resolve('@test/lib', from);

    expect(resolved.name).toBe('@test/lib');
    expect(resolved.source).toBe('node_modules');
  });

  it('peer：宽松声明未安装时抛 PackageResolutionError，由 optional 引用容错', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        peerDependencies: { '@test/lib': '^1.0.0' },
        zhin: {
          ...pluginManifest,
          plugins: [{ package: '@test/lib', instanceKey: 'lib', optional: true }],
        },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    await expect(resolver.resolve('@test/lib', from))
      .rejects.toBeInstanceOf(PackageResolutionError);
    const graph = await new ProjectGraphService(resolver).inspect(root);
    expect(graph.root.children).toEqual([]);
  });

  it('workspace:*：未命中扫描面时回退 node_modules（examples 等面外链接）', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        dependencies: { '@test/lib': 'workspace:*' },
        zhin: pluginManifest,
      },
      'node_modules/@test/lib/package.json': { name: '@test/lib', zhin: featureManifest },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    const resolved = await resolver.resolve('@test/lib', from);

    expect(resolved.source).toBe('node_modules');
  });

  it('workspace:*：声明但处处缺失时报 is missing', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        dependencies: { '@test/lib': 'workspace:*' },
        zhin: pluginManifest,
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const from = await resolver.root(root);

    await expect(resolver.resolve('@test/lib', from))
      .rejects.toThrow('Workspace dependency @test/lib declared by @test/root is missing');
  });

  it('optional-missing：声明但未安装的 optional 引用被省略', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        dependencies: { '@test/optional': '^1.0.0' },
        zhin: {
          ...pluginManifest,
          plugins: [{ package: '@test/optional', instanceKey: 'opt', optional: true }],
        },
      },
    });
    const resolver = await NodePackageResolver.create(root);

    const graph = await new ProjectGraphService(resolver).inspect(root);

    expect(graph.root.children).toEqual([]);
  });

  it('optional-missing：未声明的 optional 引用同样容错（统一 PackageResolutionError 容错）', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        zhin: {
          ...pluginManifest,
          plugins: [{ package: '@test/optional', instanceKey: 'opt', optional: true }],
        },
      },
    });
    const resolver = await NodePackageResolver.create(root);

    const graph = await new ProjectGraphService(resolver).inspect(root);

    expect(graph.root.children).toEqual([]);
  });

  it('optional-missing：workspace:* 声明但链接缺失的 optional 引用同样容错', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        dependencies: { '@test/optional': 'workspace:*' },
        zhin: {
          ...pluginManifest,
          plugins: [{ package: '@test/optional', instanceKey: 'opt', optional: true }],
        },
      },
    });
    const resolver = await NodePackageResolver.create(root);

    const graph = await new ProjectGraphService(resolver).inspect(root);

    expect(graph.root.children).toEqual([]);
  });

  it('非 optional：声明但未安装的引用仍然失败', async () => {
    const root = await fixture({
      'package.json': {
        name: '@test/root',
        dependencies: { '@test/required': '^1.0.0' },
        zhin: {
          ...pluginManifest,
          plugins: [{ package: '@test/required', instanceKey: 'req' }],
        },
      },
    });
    const resolver = await NodePackageResolver.create(root);

    await expect(new ProjectGraphService(resolver).inspect(root))
      .rejects.toBeInstanceOf(PackageResolutionError);
  });
});
