import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { filesWhitelistIncludes } from '../../src/plugin-check/files-whitelist.js';
import { checkPluginSource, readPluginManifest } from '../../src/plugin-check/source-checks.js';
import { findMissingConventionFiles, loadSpecifierScanner } from '../../src/plugin-check/pack-checks.js';
import { checkPlugin, formatPluginCheckReport } from '../../src/plugin-check/index.js';
import { scanRelativeSpecifiers } from '../../shared/pack-rules.mjs';
import { createPluginManifest, runtimeEntryJsGlobs } from '../../src/commands/new-plugin-manifest.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createPluginDirectory(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-plugin-check-test-'));
  temporaryDirectories.push(directory);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
  return directory;
}

function scaffoldManifest(): Record<string, unknown> {
  const ranges = { 'zhin.js': '^1.0.0', '@zhin.js/testing': '^1.0.0' } as Record<string, string>;
  return createPluginManifest({
    pluginName: 'example',
    kind: 'normal',
    packageName: 'zhin.js-example',
    description: 'Example plugin',
    keywords: ['zhin.js'],
    peerRanges: ranges,
    devRanges: ranges,
  } as Parameters<typeof createPluginManifest>[0]);
}

function healthyPlugin(manifest: Record<string, unknown> = scaffoldManifest()): string {
  return createPluginDirectory({
    'package.json': JSON.stringify(manifest),
    'plugin.ts': "export default {};\n",
    'commands/hello.ts': "export default {};\n",
    'skills/greet/SKILL.md': '# greet\n',
    'src/index.ts': 'export {};\n',
    'tests/plugin.test.ts': '',
    'README.md': '# example\n',
  });
}

describe('files whitelist matching', () => {
  it('matches directories, single-segment and recursive globs, and honours negation', () => {
    expect(filesWhitelistIncludes(['lib'], 'lib/index.js')).toBe(true);
    expect(filesWhitelistIncludes(['./plugin.js'], 'plugin.js')).toBe(true);
    expect(filesWhitelistIncludes(['commands/**/*.js'], 'commands/hello.js')).toBe(true);
    expect(filesWhitelistIncludes(['commands/**/*.js'], 'commands/nested/hello.js')).toBe(true);
    expect(filesWhitelistIncludes(['commands/*.js'], 'commands/nested/hello.js')).toBe(false);
    expect(filesWhitelistIncludes(['lib', '!lib/**/*.test.js'], 'lib/a.test.js')).toBe(false);
    expect(filesWhitelistIncludes(['lib'], 'plugin.js')).toBe(false);
  });

  it('covers every runtime entry the zhin new template generates', () => {
    const files = runtimeEntryJsGlobs();
    expect(filesWhitelistIncludes(files, 'plugin.js')).toBe(true);
    expect(filesWhitelistIncludes(files, 'tools/search/index.js')).toBe(true);
  });
});

describe('plugin source checks', () => {
  it('accepts the manifest zhin new generates', () => {
    const directory = healthyPlugin();
    const problems = { errors: [] as string[], warnings: [] as string[] };
    const manifest = readPluginManifest(directory, problems)!;

    const result = checkPluginSource(directory, manifest);

    expect(problems.errors).toEqual([]);
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('reports a TypeScript entry, an uncovered entry and an uncovered convention directory', () => {
    const manifest = scaffoldManifest();
    manifest.files = ['lib', 'README.md'];
    (manifest.zhin as Record<string, unknown>).entry = './plugin.ts';
    const directory = healthyPlugin(manifest);

    const tsEntry = checkPluginSource(directory, manifest);
    expect(tsEntry.errors.some((error) => error.includes('不是 JavaScript'))).toBe(true);

    (manifest.zhin as Record<string, unknown>).entry = './plugin.js';
    const result = checkPluginSource(directory, manifest);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('zhin.entry -> ./plugin.js 不在 files 白名单中'),
      expect.stringContaining('约定目录 commands/'),
      expect.stringContaining('约定目录 skills/'),
    ]));
  });

  it('reports a missing zhin manifest and warns about a missing files whitelist', () => {
    const directory = createPluginDirectory({ 'package.json': JSON.stringify({ name: 'plain-package' }) });

    const result = checkPluginSource(directory, { name: 'plain-package' });

    expect(result.errors).toEqual([expect.stringContaining('缺少 zhin 清单')]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('未声明 files 白名单'),
      expect.stringContaining('README.md'),
    ]));
  });

  it('reports missing and invalid package.json', async () => {
    const empty = createPluginDirectory({});
    const missing = await checkPlugin(empty, { pack: false });
    expect(missing.errorCount).toBe(1);
    expect(missing.source.errors[0]).toContain('缺少 package.json');

    const invalid = createPluginDirectory({ 'package.json': '{ nope' });
    const broken = await checkPlugin(invalid, { pack: false });
    expect(broken.source.errors[0]).toContain('无法解析');
  });
});

describe('pack checks', () => {
  it('requires packed JavaScript for every runtime-entry source and packed assets', () => {
    const directory = healthyPlugin();

    const missing = findMissingConventionFiles(directory, ['package.json', 'plugin.js']);
    expect(missing.errors).toEqual([
      'commands/hello.ts 没有打包对应的 commands/hello.js（prepack 未生成，或 files 未包含）',
      expect.stringContaining('skills/greet/SKILL.md'),
    ]);

    const complete = findMissingConventionFiles(directory, ['plugin.js', 'commands/hello.js', 'skills/greet/SKILL.md']);
    expect(complete).toEqual({ errors: [], warnings: [] });
  });

  it('falls back to the dependency-free specifier scanner without typescript', () => {
    const directory = createPluginDirectory({ 'package.json': '{}' });
    const outsideAnyNodeModules = path.join(os.tmpdir(), path.basename(directory));
    const scanner = loadSpecifierScanner(outsideAnyNodeModules);
    const source = "import a from './a.js';\nexport * from '../b.js';\nconst c = await import('./c.js');\nimport 'zhin.js';\n";

    expect(scanner.scan(source)).toEqual(['./a.js', '../b.js', './c.js']);
    expect(scanRelativeSpecifiers("const x = require('./x.cjs');")).toEqual(['./x.cjs']);
  });

  it('formats a report with sections, a skipped pack and totals', async () => {
    const directory = healthyPlugin();
    const report = await checkPlugin(directory, { pack: false });

    const text = formatPluginCheckReport(report, { pack: false });

    expect(report.errorCount).toBe(0);
    expect(text).toContain('zhin plugin check: zhin.js-example');
    expect(text).toContain('已跳过（--no-pack）');
    expect(text).toContain('结果：0 个错误，0 个警告');
  });

  it('packs a real plugin and reports a broken relative import and a missing compiled entry', async () => {
    const directory = createPluginDirectory({
      'package.json': JSON.stringify({
        name: 'zhin.js-pack-fixture',
        version: '0.0.0',
        type: 'module',
        main: './plugin.js',
        files: ['plugin.js', 'commands/**/*.js', 'README.md'],
        zhin: { type: 'plugin', entry: './plugin.js' },
      }),
      'plugin.js': "import { helper } from './lib/helper.js';\nexport default helper;\n",
      'commands/hello.ts': 'export default {};\n',
      'README.md': '# fixture\n',
      'tests/plugin.test.ts': '',
    });

    const report = await checkPlugin(directory);

    expect(report.pack?.packedFiles).toBe(3);
    expect(report.pack?.errors).toEqual(expect.arrayContaining([
      "plugin.js: './lib/helper.js' -> lib/helper.js is not in the tarball",
      'commands/hello.ts 没有打包对应的 commands/hello.js（prepack 未生成，或 files 未包含）',
    ]));
    expect(report.errorCount).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
