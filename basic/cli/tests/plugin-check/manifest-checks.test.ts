import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPeerDependencies, checkZhinManifest } from '../../src/plugin-check/manifest-checks.js';
import { smokeImportPackedEntry } from '../../src/plugin-check/pack-checks.js';
import type { PluginCheckProblems } from '../../src/plugin-check/source-checks.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createDirectory(files: Record<string, string> = {}): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-plugin-manifest-test-'));
  temporaryDirectories.push(directory);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
  return directory;
}

function emptyProblems(): PluginCheckProblems {
  return { errors: [], warnings: [] };
}

function pluginManifest(overrides: Record<string, unknown> = {}, zhin: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'zhin.js-example',
    version: '0.1.0',
    type: 'module',
    peerDependencies: { 'zhin.js': '^1.0.0', '@zhin.js/command': '^1.0.0' },
    ...overrides,
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.js',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: [{ package: '@zhin.js/command', api: '^1.0.0' }],
      plugins: [],
      ...zhin,
    },
  };
}

describe('zhin manifest validation', () => {
  it('accepts the manifest shape zhin new generates', () => {
    const problems = emptyProblems();

    checkZhinManifest(createDirectory(), pluginManifest(), problems);

    expect(problems).toEqual({ errors: [], warnings: [] });
  });

  it('reports Runtime parser issues for protocol and runtime', () => {
    const problems = emptyProblems();

    checkZhinManifest(createDirectory(), pluginManifest({}, { protocol: 2, runtime: 'sandboxed' }), problems);

    expect(problems.errors).toEqual(expect.arrayContaining([
      'zhin 清单无效：package.json#zhin.protocol must be 1',
      'zhin 清单无效：package.json#zhin.runtime must be "trusted" or "isolated"',
    ]));
  });

  it('reports an engine range the Runtime does not satisfy and an invalid feature api range', () => {
    const problems = emptyProblems();

    checkZhinManifest(createDirectory(), pluginManifest({}, {
      engine: '^2.0.0',
      features: [{ package: '@zhin.js/command', api: 'one point oh' }],
    }), problems);

    expect(problems.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('zhin.engine：Invalid engine contract for zhin.js-example: requires ^2.0.0'),
      expect.stringContaining('api 不是有效的 semver 范围：one point oh'),
    ]));
  });

  it('warns about a missing engine and rejects undeclared feature packages', () => {
    const problems = emptyProblems();

    checkZhinManifest(createDirectory(), pluginManifest({ peerDependencies: { 'zhin.js': '^1.0.0' } }, { engine: undefined }), problems);

    expect(problems.warnings).toEqual([expect.stringContaining('未声明 zhin.engine')]);
    expect(problems.errors).toEqual([expect.stringContaining('zhin.features 引用了 @zhin.js/command')]);
  });
});

describe('peerDependencies policy', () => {
  it('accepts real ranges that the installed dev copy satisfies', () => {
    const directory = createDirectory({ 'node_modules/zhin.js/package.json': JSON.stringify({ name: 'zhin.js', version: '1.2.3' }) });
    const problems = emptyProblems();

    checkPeerDependencies(directory, pluginManifest(), problems);

    expect(problems).toEqual({ errors: [], warnings: [] });
  });

  it('rejects latest, local protocols and invalid ranges; warns about stack packages in dependencies', () => {
    const problems = emptyProblems();

    checkPeerDependencies(createDirectory(), pluginManifest({
      dependencies: { '@zhin.js/command': '^1.0.0' },
      peerDependencies: { 'zhin.js': 'latest', '@zhin.js/tool': 'file:../tool', '@zhin.js/skill': 'not a range' },
    }), problems);

    expect(problems.errors).toEqual([
      expect.stringContaining('peerDependencies.zhin.js 为 "latest"'),
      expect.stringContaining('peerDependencies.@zhin.js/tool 为 file:../tool'),
      expect.stringContaining('peerDependencies.@zhin.js/skill 不是有效的 semver 范围'),
    ]);
    expect(problems.warnings).toEqual([expect.stringContaining('@zhin.js/command 写在 dependencies 中')]);
  });

  it('warns when zhin.js is not a peer or the installed copy is outside the range', () => {
    const directory = createDirectory({ 'node_modules/@zhin.js/command/package.json': JSON.stringify({ version: '2.0.0' }) });
    const problems = emptyProblems();

    checkPeerDependencies(directory, pluginManifest({ peerDependencies: { '@zhin.js/command': '^1.0.0' } }), problems);

    expect(problems.errors).toEqual([]);
    expect(problems.warnings).toEqual([
      expect.stringContaining('peerDependencies 未声明 zhin.js'),
      expect.stringContaining('本地安装的是 2.0.0'),
    ]);
  });
});

describe('packed entry import smoke test', () => {
  function unpacked(entrySource: string, withDependency: boolean) {
    const pluginDirectory = createDirectory(withDependency
      ? {
        'node_modules/fake-dependency/package.json': JSON.stringify({ name: 'fake-dependency', type: 'module', exports: './index.js' }),
        'node_modules/fake-dependency/index.js': 'export const value = 1;\n',
      }
      : {});
    const packageRoot = createDirectory({ 'package.json': JSON.stringify({ type: 'module' }), 'plugin.js': entrySource });
    return { pluginDirectory, packageRoot };
  }

  const manifest = { zhin: { entry: './plugin.js' } };

  it('imports the entry with the plugin node_modules linked in', async () => {
    const { pluginDirectory, packageRoot } = unpacked("import { value } from 'fake-dependency';\nexport default value;\n", true);

    const result = await smokeImportPackedEntry(pluginDirectory, packageRoot, manifest, new Set(['plugin.js']));

    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('reports an entry that cannot be imported', async () => {
    const { pluginDirectory, packageRoot } = unpacked("import './lib/missing.js';\n", true);

    const result = await smokeImportPackedEntry(pluginDirectory, packageRoot, manifest, new Set(['plugin.js']));

    expect(result.errors).toEqual([expect.stringContaining('import 打包入口 plugin.js 失败')]);
    expect(result.errors[0]).toContain('missing.js');
  });

  it('skips with a warning when dependencies are not installed', async () => {
    const { pluginDirectory, packageRoot } = unpacked('export default 1;\n', false);

    const result = await smokeImportPackedEntry(pluginDirectory, packageRoot, manifest, new Set(['plugin.js']));

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('跳过打包入口的 import 冒烟测试')]);
  });
});
