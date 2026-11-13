import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONVENTION_FEATURE_PACKAGES,
  inferConventionFeatureReferences,
  NodePackageResolver,
  PackageResolutionError,
  ProjectGraphService,
  parsePackageJson,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('convention Feature inference', () => {
  it('maps each present convention directory to its Feature package', async () => {
    const root = await directoryWith(['commands/demo', 'tools/search', 'skills/greet', 'pages/index', 'notes']);
    expect(inferConventionFeatureReferences(root, { type: 'plugin' })).toEqual([
      { package: '@zhin.js/command', directory: 'commands' },
      { package: '@zhin.js/tool', directory: 'tools' },
      { package: '@zhin.js/skill', directory: 'skills' },
    ]);
    expect(CONVENTION_FEATURE_PACKAGES.middlewares).toBe('@zhin.js/middleware');
  });

  it('does not infer when features is listed, even as an empty list', async () => {
    const root = await directoryWith(['commands/demo', 'handlers/message']);
    const manifest = { type: 'plugin', features: [{ package: '@zhin.js/command', api: '^1.2.0', optional: true }] };
    expect(inferConventionFeatureReferences(root, manifest)).toEqual([]);
    expect(inferConventionFeatureReferences(root, { type: 'plugin', features: [] })).toEqual([]);
  });

  it('treats a parsed manifest without features as omitted and infers nothing for Features or isolated Plugins', async () => {
    const root = await directoryWith(['commands/demo']);
    const omitted = parsePackageJson({ name: 'demo', zhin: { protocol: 1, type: 'plugin' } }, 'package.json').zhin;
    expect(omitted).toMatchObject({ features: [], featuresOmitted: true });
    expect(inferConventionFeatureReferences(root, omitted)).toEqual([
      { package: '@zhin.js/command', directory: 'commands' },
    ]);
    const listed = parsePackageJson({ name: 'demo', zhin: { protocol: 1, type: 'plugin', features: [] } }, 'package.json').zhin;
    expect('featuresOmitted' in listed).toBe(false);
    expect(inferConventionFeatureReferences(root, { type: 'feature' })).toEqual([]);
    expect(inferConventionFeatureReferences(root, { type: 'plugin', runtime: 'isolated' })).toEqual([]);
  });
});

describe('Project Graph with inferred Features', () => {
  it('mounts the Feature implied by a convention directory when features is omitted', async () => {
    const root = await project({ dependencies: { '@zhin.js/command': 'workspace:*' } }, ['commands/demo']);
    const graph = await inspect(root);
    expect(graph.root.features.map((item) => [item.package.name, item.inferredFrom, item.reference])).toEqual([
      ['@zhin.js/command', 'commands', { package: '@zhin.js/command' }],
    ]);
  });

  it('uses an explicit features entry with its api range instead of inferring the package', async () => {
    const root = await project({
      dependencies: { '@zhin.js/command': 'workspace:*' },
      features: [{ package: '@zhin.js/command', api: '^1.0.0' }],
    }, ['commands/demo']);
    const graph = await inspect(root);
    expect(graph.root.features.map((item) => [item.package.name, item.inferredFrom, item.reference.api])).toEqual([
      ['@zhin.js/command', undefined, '^1.0.0'],
    ]);
  });

  it('fails like a missing declared Feature and names the directory when features is omitted', async () => {
    const root = await project({}, ['commands/demo']);
    const failure = inspect(root);
    await expect(failure).rejects.toBeInstanceOf(PackageResolutionError);
    await expect(failure).rejects.toThrow(
      /references @zhin\.js\/command in zhin manifest but does not declare it as a package dependency.*inferred from the convention directory commands\//,
    );
  });

  it('keeps a listed features array authoritative even when the directory Feature is installed', async () => {
    const root = await project({ dependencies: { '@zhin.js/command': 'workspace:*' }, features: [] }, ['commands/demo']);
    const graph = await inspect(root);
    expect(graph.root.features).toEqual([]);
  });

  it('keeps loading as before when features is listed and the directory Feature is not installed', async () => {
    const root = await project({ features: [] }, ['commands/demo']);
    const graph = await inspect(root);
    expect(graph.root.features).toEqual([]);
  });
});

async function directoryWith(directories: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-feature-inference-'));
  temporary.push(root);
  for (const directory of directories) await mkdir(join(root, directory), { recursive: true });
  return root;
}

async function project(
  input: { dependencies?: Record<string, string>; features?: unknown[] },
  directories: readonly string[],
): Promise<string> {
  const root = await directoryWith(directories);
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      platformFeatures: false,
      ...(input.features ? { features: input.features } : {}),
    },
  });
  await writeJson(join(root, 'packages/command/package.json'), {
    name: '@zhin.js/command',
    zhin: { protocol: 1, type: 'feature', entry: './index.ts', featureApi: '1.0.0' },
  });
  return realpath(root);
}

async function inspect(root: string) {
  const resolver = await NodePackageResolver.create(root);
  return new ProjectGraphService(resolver).inspect(root, { configVersion: 2, plugins: {} });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
