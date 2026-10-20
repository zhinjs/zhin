import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import inquirer from 'inquirer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONVENTION_SOURCE_DIRECTORIES,
  FALLBACK_STACK_RANGE,
  PLUGIN_TOOLING_RANGES,
  RUNTIME_ENTRIES_SCRIPT,
  RUNTIME_ENTRIES_SCRIPT_PATH,
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
    expect(pkg.scripts.prepack).toBe('pnpm run build && node scripts/build-runtime-entries.mjs');
    expect(pkg.scripts.postpack).toBe('node scripts/build-runtime-entries.mjs --clean');
    expect(pkg.scripts.build).toBe('tsc -p tsconfig.build.json');
    const { build } = createPluginTsconfigs('normal');
    expect(build.include).toEqual(['src/**/*']);
    expect(build.compilerOptions).toMatchObject({ noEmit: false, rootDir: './src', outDir: './lib', declaration: true });
  });

  it('follows the publishing layout standard: lib/ with .d.ts, runtime entries as JS, no sources', () => {
    const pkg = manifest('normal');
    expect(pkg.main).toBe('./lib/index.js');
    expect(pkg.types).toBe('./lib/index.d.ts');
    expect(pkg.exports['.']).toEqual({ types: './lib/index.d.ts', import: './lib/index.js' });
    expect(pkg.files).toContain('lib');
    expect(pkg.files).not.toContain('src');
    for (const entry of pkg.files as string[]) {
      expect(entry, entry).not.toMatch(/\.tsx?$|^tests|tsconfig|vitest/);
    }
  });

  it('runtime entry builder rewrites src/ imports to lib/ and only cleans generated files', async () => {
    const dir = await tempDir();
    await fs.outputFile(path.join(dir, 'plugin.ts'), "import { a } from './src/index.js';\nexport default a;\n");
    await fs.outputFile(path.join(dir, 'commands', 'x', 'index.ts'),
      "import type { T } from '../../src/types.ts';\nimport { b } from '../../src/index.ts';\nexport default b as T;\n");
    await fs.outputFile(path.join(dir, 'commands', 'x', 'helper.test.ts'), 'export {};\n');
    await fs.outputFile(path.join(dir, 'commands', 'y', 'index.js'), 'export default 1;\n');
    await fs.outputFile(path.join(dir, RUNTIME_ENTRIES_SCRIPT_PATH), RUNTIME_ENTRIES_SCRIPT);
    // the generated plugin resolves typescript from its own devDependencies; borrow the CLI's copy
    await fs.ensureSymlink(path.resolve(__dirname, '../../../node_modules/typescript'), path.join(dir, 'node_modules', 'typescript'));
    const script = path.join(dir, RUNTIME_ENTRIES_SCRIPT_PATH);
    execFileSync(process.execPath, [script], { cwd: dir });
    expect(await fs.readFile(path.join(dir, 'plugin.js'), 'utf8')).toMatch(/from ['"]\.\/lib\/index\.js['"]/);
    const command = await fs.readFile(path.join(dir, 'commands', 'x', 'index.js'), 'utf8');
    expect(command).toMatch(/from ['"]\.\.\/\.\.\/lib\/index\.js['"]/);
    expect(command).not.toContain('types');
    expect(await fs.pathExists(path.join(dir, 'commands', 'x', 'helper.test.js'))).toBe(false);
    execFileSync(process.execPath, [script, '--clean'], { cwd: dir });
    expect(await fs.pathExists(path.join(dir, 'plugin.js'))).toBe(false);
    expect(await fs.pathExists(path.join(dir, 'commands', 'x', 'index.js'))).toBe(false);
    expect(await fs.pathExists(path.join(dir, 'commands', 'y', 'index.js'))).toBe(true);
  });

  it.each(['normal', 'service', 'adapter'] as const)('%s: ships and type-checks every server-side convention directory', (kind) => {
    const pkg = manifest(kind);
    const { tsconfig } = createPluginTsconfigs(kind);
    for (const dir of CONVENTION_SOURCE_DIRECTORIES) {
      expect(pkg.files, dir).toContain(`${dir}/**/*.js`);
      expect(tsconfig.include, dir).toContain(`${dir}/**/*`);
    }
    expect(tsconfig.include).toContain('src/**/*');
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
