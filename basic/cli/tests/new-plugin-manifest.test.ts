import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import inquirer from 'inquirer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONVENTION_SOURCE_DIRECTORIES,
  FALLBACK_STACK_RANGE,
  PLUGIN_TOOLING_RANGES,
  caretRange,
  createPluginManifest,
  createPluginTsconfigs,
  findInstalledVersion,
  resolvePluginPackageName,
  resolvePluginStackRanges,
  workspaceStackRanges,
  type PluginKind,
  type PluginStackRanges,
} from '../src/commands/new-plugin-manifest.js';

const repoRoot = path.resolve(__dirname, '../../..');
const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => fs.remove(dir)));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-new-manifest-'));
  fixtures.push(dir);
  return dir;
}

async function installFake(root: string, name: string, version: string, exportsField?: unknown) {
  await fs.outputJson(path.join(root, 'node_modules', ...name.split('/'), 'package.json'), {
    name,
    version,
    ...(exportsField ? { exports: exportsField } : {}),
  });
}

const ranges: PluginStackRanges = {
  'zhin.js': '^1.1.8',
  '@zhin.js/skill': '^1.1.3',
  '@zhin.js/command': '^1.1.6',
  '@zhin.js/adapter': '^1.1.4',
  '@zhin.js/testing': '^1.0.3',
};

function manifest(kind: PluginKind) {
  return createPluginManifest({
    pluginName: 'demo',
    packageName: 'zhin.js-demo',
    kind,
    description: 'demo',
    keywords: ['zhin.js'],
    peerRanges: ranges,
    devRanges: ranges,
  }) as Record<string, any>;
}

describe('resolvePluginStackRanges', () => {
  it('derives ^x.y.z from the host project, even when exports hide package.json', async () => {
    const root = await tempDir();
    await installFake(root, 'zhin.js', '1.1.8', { '.': { import: './lib/index.js' } });
    await installFake(root, '@zhin.js/skill', '1.1.3-beta.1');
    const nested = path.join(root, 'plugins', 'x');
    await fs.ensureDir(nested);
    expect(findInstalledVersion('zhin.js', nested)).toBe('1.1.8');
    const resolved = resolvePluginStackRanges(nested, []);
    expect(resolved['zhin.js']).toBe('^1.1.8');
    expect(resolved['@zhin.js/skill']).toBe('^1.1.3');
    expect(resolved['@zhin.js/command']).toBe(FALLBACK_STACK_RANGE);
  });

  it('falls back to the CLI install location before the wide default', async () => {
    const host = await tempDir();
    const cli = await tempDir();
    await installFake(cli, '@zhin.js/command', '1.1.6');
    expect(resolvePluginStackRanges(host, [cli])['@zhin.js/command']).toBe('^1.1.6');
  });

  it('never yields latest or another non-semver range', async () => {
    const host = await tempDir();
    for (const range of Object.values(resolvePluginStackRanges(host))) {
      expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    }
    expect(caretRange('latest')).toBeUndefined();
  });

  it('uses workspace protocols only inside the zhin monorepo root', async () => {
    expect(workspaceStackRanges(repoRoot)).toMatchObject({
      peer: { 'zhin.js': 'workspace:^' },
      dev: { 'zhin.js': 'workspace:*' },
    });
    expect(workspaceStackRanges(await tempDir())).toBeNull();
  });
});

describe('createPluginManifest', () => {
  it.each(['normal', 'service', 'adapter'] as const)('%s: capability packages are optional peers, never dependencies', (kind) => {
    const pkg = manifest(kind);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies['zhin.js']).toBe('^1.1.8');
    expect(pkg.peerDependenciesMeta['zhin.js']).toBeUndefined();
    for (const feature of pkg.zhin.features as Array<{ package: string }>) {
      expect(pkg.peerDependencies[feature.package]).toBeDefined();
      expect(pkg.peerDependenciesMeta[feature.package]).toEqual({ optional: true });
      expect(pkg.devDependencies[feature.package]).toBe(pkg.peerDependencies[feature.package]);
    }
    expect(JSON.stringify(pkg)).not.toContain('latest');
  });

  it('publishes built JavaScript, not the TypeScript entry', () => {
    const pkg = manifest('normal');
    expect(pkg.zhin.entry).toBe('./plugin.js');
    expect(pkg.files).toContain('plugin.js');
    expect(pkg.files).not.toContain('plugin.ts');
    expect(pkg.scripts.prepack).toBe('pnpm run build');
    expect(pkg.scripts.build).toBe('tsc -p tsconfig.build.json');
    const { build } = createPluginTsconfigs('normal');
    expect(build.include).toEqual(['plugin.ts', ...['src', ...CONVENTION_SOURCE_DIRECTORIES].map((dir) => `${dir}/**/*`)]);
    expect((build.compilerOptions as Record<string, unknown>).noEmit).toBe(false);
  });

  it.each(['normal', 'service', 'adapter'] as const)('%s: ships and compiles every server-side convention directory', (kind) => {
    const pkg = manifest(kind);
    const { tsconfig, build } = createPluginTsconfigs(kind);
    for (const dir of CONVENTION_SOURCE_DIRECTORIES) {
      expect(pkg.files, dir).toContain(dir);
      expect(build.include, dir).toContain(`${dir}/**/*`);
      expect(tsconfig.include, dir).toContain(`${dir}/**/*`);
    }
    expect(pkg.files).toEqual(expect.arrayContaining(['skills', 'agents']));
  });

  it('generated tests use @zhin.js/testing from devDependencies', () => {
    const pkg = manifest('normal');
    expect(pkg.devDependencies['@zhin.js/testing']).toBeDefined();
    expect(pkg.peerDependencies['@zhin.js/testing']).toBeUndefined();
  });

  it('keeps tooling ranges in step with the repository root', async () => {
    const root = await fs.readJson(path.join(repoRoot, 'package.json'));
    for (const [name, range] of Object.entries(PLUGIN_TOOLING_RANGES)) {
      expect(root.devDependencies[name], name).toBe(range);
    }
  });
});

describe('resolvePluginPackageName', () => {
  it('defaults third-party plugins to an unscoped name', () => {
    expect(resolvePluginPackageName('demo', {})).toBe('zhin.js-demo');
    expect(resolvePluginPackageName('demo', { isOfficial: true })).toBe('@zhin.js/demo');
    expect(resolvePluginPackageName('demo', { packageName: '@me/zhin-plugin-demo' })).toBe('@me/zhin-plugin-demo');
  });

  it('refuses the official scope without --is-official and invalid names', () => {
    expect(() => resolvePluginPackageName('demo', { packageName: '@zhin.js/demo' })).toThrow(/官方/);
    expect(() => resolvePluginPackageName('demo', { packageName: 'Bad Name' })).toThrow(/无效/);
  });
});

describe('CLI prompts', () => {
  it('only uses prompt types registered by the installed inquirer', async () => {
    const registered = Object.keys((inquirer.prompt as unknown as { prompts: Record<string, unknown> }).prompts);
    expect(registered).toContain('select');
    const sourceDir = path.resolve(__dirname, '../src');
    const files = (await fs.readdir(sourceDir, { recursive: true }))
      .map(String)
      .filter((file) => file.endsWith('.ts'));
    const offenders: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(path.join(sourceDir, file), 'utf8');
      if (!/from 'inquirer'/.test(text)) continue;
      for (const match of text.matchAll(/inquirer\.prompt\([\s\S]*?\]\)/g)) {
        for (const type of match[0].matchAll(/type:\s*'([a-z]+)'/g)) {
          if (!registered.includes(type[1])) offenders.push(`${file}: ${type[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
