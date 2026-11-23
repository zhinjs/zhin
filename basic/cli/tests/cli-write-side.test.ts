/**
 * CLI 写侧 legacy 残留修复回归测试：
 * - config-file utils：Root YAML/JSON 读写与唯一文件约束
 * - config 命令：JSON 配置 set 真正落盘
 * - doctor createDefaultConfig：新 Plugin Runtime map 形态
 * - migrate：engines.node、中文模板多命中判定、覆盖前 .bak 备份
 * - schedule：经运行中 Host 的 /assistant/jobs 读写、非法输入统一报错
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { diagnoseConsoleConfig } from '@zhin.js/scaffold-wizard';
import { formatDateTime } from '@zhin.js/plugin-runtime';
import { findConfigFile, readConfig, saveConfig } from '../../../packages/host/gateway/src/project/config-file.js';
import { configCommand } from '../src/commands/config.js';
import { createDefaultConfig } from '../src/commands/doctor.js';
import {
  isOldChineseTemplate,
  upgradeBootstrapFiles,
  upgradePackageJson,
  isPinnedSpecifier,
  isLocalDependencySpecifier,
  isNewerThanRelease,
  syncWorkspaceYamlOverrides,
  upgradeProjectDependencies,
  upgradeWorkspacePackages,
  reportRetiredPackages,
} from '../src/commands/migrate.js';
import { cachedRegistryLookup, npmRegistryLookup } from '../src/utils/registry-version.js';
import { expandWorkspaceBraces, listWorkspacePackageDirs, workspaceGlobToRegExp } from '../src/utils/workspace-packages.js';
import { describeScheduleRefusal, scheduleCommand } from '../src/commands/schedule.js';
import { SOUL_MD_TEMPLATE, TOOLS_MD_TEMPLATE } from '../../../packages/toolkit/create-zhin/src/templates/bootstrap.js';

// `zhin schedule` only talks to this project's gateway (#1250): a stand-in whose local-socket
// fetch delegates to the stubbed global fetch while `gateway.running` is set.
const gateway = vi.hoisted(() => ({ running: false }));
vi.mock('@zhin.js/gateway/local', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zhin.js/gateway/local')>(),
  probeLocalGateway: async () => (gateway.running ? { ok: true } : undefined),
  createLocalGatewayFetch: () => ((url: unknown, init?: RequestInit) => globalThis.fetch(url as string, init)),
}));

// Migration queries the registry; tests answer from a fixed fake registry instead of the network.
const registry = vi.hoisted(() => ({
  latest: '9.4.2',
  zhinDependencies: { '@zhin.js/core': '^9.4.1', '@zhin.js/ai': '^9.4.0' } as Record<string, string>,
  offline: false,
  calls: [] as string[],
}));
vi.mock('../src/utils/registry-version.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/utils/registry-version.js')>();
  return {
    ...actual,
    npmRegistryLookup: (name: string, spec = 'latest') => {
      registry.calls.push(`${name}@${spec}`);
      if (registry.offline) return undefined;
      const version = spec === 'latest' ? registry.latest : spec;
      return { version, dependencies: name === 'zhin.js' ? registry.zhinDependencies : {} };
    },
  };
});

let tmp: string;
let prevCwd: string;

beforeEach(() => {
  registry.offline = false;
  registry.calls.length = 0;
  prevCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-cli-test-'));
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('utils/config-file', () => {
  it('JSON 配置可读写往返', async () => {
    const file = path.join(tmp, 'config.json');
    await saveConfig(file, {configVersion: 2, plugins: {}, log_level: 'info', ai: {enabled: false}});
    const config = await readConfig(file);
    expect(config).toEqual({configVersion: 2, plugins: {}, log_level: 'info', ai: {enabled: false}});
  });

  it('findConfigFile 能发现六种契约内的 Root 配置名', () => {
    fs.writeFileSync(path.join(tmp, 'config.yaml'), 'log_level: info\n');
    expect(findConfigFile(tmp)).toBe('config.yaml');
  });

  it('rejects multiple Root configuration authorities', () => {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}\n');
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), '{}\n');
    expect(() => findConfigFile(tmp)).toThrow(/Multiple Root config files found/);
  });
});

describe('config 命令（JSON 落盘）', () => {
  it('config set 真正写入 config.json', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'config-command-fixture', version: '1.0.0', type: 'module',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.mjs', platformFeatures: false } }));
    fs.writeFileSync(path.join(tmp, 'plugin.mjs'), 'export default {};');
    fs.writeFileSync(
      path.join(tmp, 'config.json'),
      JSON.stringify({configVersion: 2, plugins: {}, log_level: 'info', ai: {enabled: false}}),
    );
    await configCommand.parseAsync(['node', 'zhin', 'set', 'log_level', 'debug', '--offline']);
    const config = await readConfig(path.join(tmp, 'config.json'));
    expect((config.ai as Record<string, unknown>).enabled).toBe(false);
    expect(config.log_level).toBe('debug');
  });
});

describe('doctor createDefaultConfig', () => {
  it('生成新 Plugin Runtime map 形态，且通过 diagnoseConsoleConfig', async () => {
    await createDefaultConfig(tmp);
    const raw = fs.readFileSync(path.join(tmp, 'zhin.config.yml'), 'utf-8');
    // 不再生成 legacy 形状
    expect(raw).not.toContain('host-router');
    expect(raw).not.toContain('host-api');
    expect(raw).not.toContain('endpoints');

    const config = yaml.parse(raw) as Record<string, unknown>;
    expect(config.plugins).toEqual({sandbox: '@zhin.js/adapter-sandbox'});
    const diagnosis = diagnoseConsoleConfig(config);
    expect(diagnosis).toEqual({
      missingSandboxPlugin: false,
      missingConsoleOrigin: false,
      missingHttpToken: false,
    });
  });
});

describe('migrate', () => {
  it.each(['root', 'nested', 'standalone'])('preserves explicit workspace dependencies for a %s package', location => {
    const directory = location === 'nested' ? path.join(tmp, 'plugins', 'example') : tmp;
    fs.mkdirSync(directory, { recursive: true });
    if (location !== 'standalone') fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
    const pkgPath = path.join(directory, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'example',
      dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/agent': '^1.1.0', 'user-library': '^2.0.0' },
      devDependencies: { '@zhin.js/core': 'workspace:^', '@zhin.js/ai': 'workspace:~', '@zhin.js/tool': 'workspace:../tool' },
      scripts: { dev: 'custom-dev', test: 'custom-test' },
    }));

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toEqual({ 'zhin.js': 'workspace:*', '@zhin.js/agent': '^9.4.2', 'user-library': '^2.0.0' });
    expect(pkg.devDependencies).toEqual({ '@zhin.js/core': 'workspace:^', '@zhin.js/ai': 'workspace:~', '@zhin.js/tool': 'workspace:../tool' });
    expect(pkg.scripts).toMatchObject({ dev: 'custom-dev', test: 'custom-test' });
  });

  it('previews a nested package upgrade without replacing workspace dependencies or writing files', () => {
    const directory = path.join(tmp, 'plugins', 'example');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
    const pkgPath = path.join(directory, 'package.json');
    const original = JSON.stringify({ dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/agent': '^1.1.0' } }, null, 4) + '\n';
    fs.writeFileSync(pkgPath, original);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(upgradePackageJson(pkgPath, { toLatest: true, dryRun: true })).toBe(true);
    expect(fs.readFileSync(pkgPath, 'utf8')).toBe(original);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('@zhin.js/agent: ^1.1.0 → ^9.4.2');
    expect(output).not.toContain('latest');
    expect(output).not.toContain('zhin.js: workspace:');
  });

  it('moves the CLI of a bot project into dependencies with zhin.js and adds the gateway', () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'bot',
      private: true,
      engines: { node: '>=22.19.0' },
      dependencies: { 'zhin.js': '^1.1.0' },
      devDependencies: { '@zhin.js/cli': '^1.1.20', typescript: '^5.0.0' },
    }, null, 2));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(upgradePackageJson(pkgPath, { toLatest: true, dryRun: true })).toBe(true);
    const preview = log.mock.calls.flat().join('\n');
    expect(preview).toContain('@zhin.js/cli: devDependencies → dependencies (^1.1.20)');
    expect(preview).toContain('@zhin.js/cli: ^1.1.20 → ^9.4.2');
    expect(preview).toContain('@zhin.js/gateway: + dependencies (~9.4.0)');
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).devDependencies['@zhin.js/cli']).toBe('^1.1.20');

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toEqual({ 'zhin.js': '^9.4.2', '@zhin.js/cli': '^9.4.2', '@zhin.js/gateway': '~9.4.0' });
    expect(pkg.devDependencies).toEqual({ typescript: '^5.0.0' });
  });

  it('keeps a pinned CLI and gives the added gateway the range released with this CLI', () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    const pkgPath = path.join(tmp, 'package.json');
    // The project pins the CLI release that runs this migration, so the gateway released with it applies
    // (a CLI on another release line gets that line's gateway; see the next test).
    const cliVersion = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version;
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'bot',
      engines: { node: '>=22.19.0' },
      dependencies: { 'zhin.js': '1.1.25' },
      devDependencies: { '@zhin.js/cli': cliVersion, 'zhin.js': '1.1.25' },
    }, null, 2));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const gatewayVersion = (JSON.parse(fs.readFileSync(
      path.join(import.meta.dirname, '../../../packages/host/gateway/package.json'),
      'utf8',
    )) as { version: string }).version;

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toEqual({
      'zhin.js': '1.1.25',
      '@zhin.js/cli': cliVersion,
      '@zhin.js/gateway': `^${gatewayVersion}`,
    });
    expect(pkg.devDependencies).toBeUndefined();
  });

  it('derives the gateway range from the project CLI release line, not the migrating CLI', async () => {
    const { gatewayRangeFor } = await import('../src/plugin-runtime/migrate/start-stack-dependencies.js');
    const scaffold = gatewayRangeFor('1.2.0', '1.2.9');
    // A CLI kept on an older line gets that line's gateway.
    expect(gatewayRangeFor('1.3.4', '1.4.0')).toBe('~1.3.0');
    expect(gatewayRangeFor('^1.3.0', '1.4.0')).toBe('~1.3.0');
    expect(gatewayRangeFor('~2.0.1', '1.4.0')).toBe('~2.0.0');
    // Same line as the migrating CLI: the range released with it; pre-gateway lines and placeholders too.
    expect(gatewayRangeFor('1.4.2', '1.4.0')).toBe(scaffold);
    expect(gatewayRangeFor('1.0.9', '1.4.0')).toBe(scaffold);
    expect(gatewayRangeFor('^0.0.0', '1.4.0')).toBe(scaffold);
    // Dist-tags and workspace protocols follow the CLI as is.
    expect(gatewayRangeFor('next', '1.4.0')).toBe('next');
    expect(gatewayRangeFor('workspace:*', '1.4.0')).toBe('workspace:*');
    // `>=` ranges and a first number without a minor before the real version.
    expect(gatewayRangeFor('>=1.3.0 <2', '1.4.0')).toBe('~1.3.0');
    expect(gatewayRangeFor('v1 || 1.3.2', '1.4.0')).toBe('~1.3.0');
  });

  it('parses a pathological version specifier in linear time', async () => {
    const { gatewayRangeFor } = await import('../src/plugin-runtime/migrate/start-stack-dependencies.js');
    const started = performance.now();
    gatewayRangeFor('0'.repeat(200_000), '1.4.0');
    gatewayRangeFor(`${'0'.repeat(100_000)}.`, '1.4.0');
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('says a placeholder ^0.0.0 CLI is replaced, not that dependencies already declare it', () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'bot',
      engines: { node: '>=22.19.0' },
      dependencies: { 'zhin.js': '^1.1.0' },
      devDependencies: { '@zhin.js/cli': '^0.0.0' },
    }, null, 2));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: true });
    const preview = log.mock.calls.flat().join('\n');
    expect(preview).toContain('@zhin.js/cli: devDependencies 中的占位版本 ^0.0.0 已移除');
    expect(preview).not.toContain('@zhin.js/cli: devDependencies 中的重复项已移除');
    expect(preview).toContain('@zhin.js/cli: + dependencies (^9.4.2)');
  });

  it('leaves the CLI of a Plugin package (no project config) in devDependencies', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'plugin',
      engines: { node: '>=22.19.0' },
      dependencies: { 'zhin.js': '^1.1.0' },
      devDependencies: { '@zhin.js/cli': '^1.1.20' },
    }, null, 2));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toEqual({ 'zhin.js': '^9.4.2' });
    expect(pkg.devDependencies).toEqual({ '@zhin.js/cli': '^9.4.2' });
  });

  it('engines.node 写 >=22.19.0', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      dependencies: { 'zhin.js': '1.0.0' },
    }, null, 2));
    const changed = upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned: true });
    expect(changed).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.engines.node).toBe('>=22.19.0');
    // --include-pinned upgrades an exact version to the registry release and keeps it exact.
    expect(pkg.dependencies['zhin.js']).toBe('9.4.2');
  });

  it('默认保留用户锁定的精确版本、link/file 等依赖，只移动范围版本', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin runtime start', start: 'zhin runtime start', daemon: 'zhin runtime start --daemon', stop: 'zhin stop', build: 'tsc --noEmit' },
      dependencies: {
        'zhin.js': '^1.1.0',
        '@zhin.js/agent-feature': '1.1.6',
        '@zhin.js/calendar': 'link:../calendar',
        '@zhin.js/local': 'file:./vendor/local.tgz',
      },
    }, null, 2));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      upgradePackageJson(pkgPath, { toLatest: true, dryRun: true });
      const output = log.mock.calls.map(args => args.join(' ')).join('\n');
      expect(output).toContain('zhin.js: ^1.1.0 → ^9.4.2');
      expect(output).not.toContain('@zhin.js/agent-feature: 1.1.6 →');
      expect(output).toContain('@zhin.js/agent-feature: 1.1.6 已锁定');
    } finally { log.mockRestore(); }
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).dependencies).toEqual({
      'zhin.js': '^9.4.2',
      '@zhin.js/agent-feature': '1.1.6',
      '@zhin.js/calendar': 'link:../calendar',
      '@zhin.js/local': 'file:./vendor/local.tgz',
    });
  });

  it('--include-pinned writes the registry release, never the dist-tag latest (#1250)', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin start --foreground --watch source config', start: 'zhin start --foreground --mode production --no-watch', stop: 'zhin stop', preview: 'zhin preview', build: 'tsc --noEmit' },
      dependencies: { 'zhin.js': '1.1.0', '@zhin.js/agent': '~1.1.0', '@zhin.js/tool': 'latest' },
      devDependencies: { '@zhin.js/cli': '=1.1.0' },
    }, null, 2));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(upgradePackageJson(pkgPath, { toLatest: true, dryRun: true, includePinned: true })).toBe(true);
    const preview = log.mock.calls.flat().join('\n');
    expect(preview).toContain('zhin.js: 1.1.0 → 9.4.2');
    expect(preview).toContain('@zhin.js/agent: ~1.1.0 → ^9.4.2');
    expect(preview).toContain('@zhin.js/tool: latest → ^9.4.2');
    expect(preview).toContain('@zhin.js/cli: =1.1.0 → 9.4.2');

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned: true });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toEqual({ 'zhin.js': '9.4.2', '@zhin.js/agent': '^9.4.2', '@zhin.js/tool': '^9.4.2' });
    expect(pkg.devDependencies).toEqual({ '@zhin.js/cli': '9.4.2' });
    expect(JSON.stringify(pkg)).not.toContain('latest');
  });

  it('--include-pinned keeps npm: aliases and local sources instead of writing ^x.y.z (#1250 review)', () => {
    const pkgPath = path.join(tmp, 'package.json');
    const dependencies = {
      'zhin.js': '1.1.0',
      '@zhin.js/core': 'npm:@zhin.js/core@1.1.0',
      '@zhin.js/agent': 'npm:my-fork-agent@^1.0.0',
      '@zhin.js/calendar': 'link:../calendar',
      '@zhin.js/local': 'file:./vendor/local.tgz',
    };
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin start --foreground --watch source config', start: 'zhin start --foreground --mode production --no-watch', stop: 'zhin stop', preview: 'zhin preview', build: 'tsc --noEmit' },
      dependencies,
    }, null, 2));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: true, includePinned: true });
    const preview = log.mock.calls.flat().join('\n');
    expect(preview).toContain('@zhin.js/core: npm:@zhin.js/core@1.1.0 是别名或本地/非 registry 来源，--include-pinned 不改写，保留');
    expect(preview).not.toMatch(/@zhin\.js\/(core|agent|calendar|local): \S+ → /u);

    const kept = new Set<string>();
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned: true, kept });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toMatchObject({ ...dependencies, 'zhin.js': '9.4.2' });
    expect([...kept].sort()).toEqual(['@zhin.js/agent', '@zhin.js/calendar', '@zhin.js/core', '@zhin.js/local']);
  });

  it('keeps a dependency and says so when the registry cannot be reached', () => {
    registry.offline = true;
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'demo', engines: { node: '>=22.19.0' }, dependencies: { 'zhin.js': '^1.1.0' } }, null, 2));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dependencies).toEqual({ 'zhin.js': '^1.1.0' });
    expect(log.mock.calls.flat().join('\n')).toContain('zhin.js: 无法从 registry 查询最新版本，保留 ^1.1.0');
  });

  it('aligns @zhin.js/* in pnpm.overrides with the dependencies of the target zhin.js (#1250)', () => {
    const pkgPath = path.join(tmp, 'package.json');
    const original = JSON.stringify({
      name: 'demo',
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin start --foreground --watch source config', start: 'zhin start --foreground --mode production --no-watch', stop: 'zhin stop', preview: 'zhin preview', build: 'tsc --noEmit' },
      dependencies: { 'zhin.js': '^1.1.0', '@zhin.js/cli': '^1.1.0' },
      pnpm: { overrides: {
        '@zhin.js/core': '1.1.0',
        '@zhin.js/ai': '~1.1.0',
        '@zhin.js/cli': '1.1.0',
        '@zhin.js/local': 'link:../local',
        '@zhin.js/unknown': '1.0.0',
        'zhin.js>@zhin.js/core': '1.1.0',
        'left-pad': '1.0.0',
      } },
    }, null, 2);
    fs.writeFileSync(pkgPath, original);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(upgradePackageJson(pkgPath, { toLatest: true, dryRun: true })).toBe(true);
    expect(fs.readFileSync(pkgPath, 'utf8')).toBe(original);
    const preview = log.mock.calls.flat().join('\n');
    expect(preview).toContain('pnpm.overrides.@zhin.js/core: 1.1.0 → ^9.4.1');
    expect(registry.calls).toContain('zhin.js@9.4.2');

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).pnpm.overrides).toEqual({
      '@zhin.js/core': '^9.4.1',
      '@zhin.js/ai': '^9.4.0',
      // Not a zhin.js dependency: follows its own upgraded specifier.
      '@zhin.js/cli': '^9.4.2',
      '@zhin.js/local': 'link:../local',
      '@zhin.js/unknown': '1.0.0',
      'zhin.js>@zhin.js/core': '1.1.0',
      'left-pad': '1.0.0',
    });
  });

  it('aligns overrides with a pinned zhin.js that the migration keeps', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      engines: { node: '>=22.19.0' },
      dependencies: { 'zhin.js': '1.2.0' },
      pnpm: { overrides: { '@zhin.js/core': '1.1.0' } },
    }, null, 2));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies['zhin.js']).toBe('1.2.0');
    expect(registry.calls).toContain('zhin.js@1.2.0');
    expect(pkg.pnpm.overrides['@zhin.js/core']).toBe('^9.4.1');
  });

  it('syncs a stale override even when zhin.js is already at the registry latest (#1250)', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin start --foreground --watch source config', start: 'zhin start --foreground --mode production --no-watch', stop: 'zhin stop', preview: 'zhin preview', build: 'tsc --noEmit' },
      dependencies: { 'zhin.js': '^9.4.2', '@zhin.js/cli': '^9.4.2' },
      pnpm: { overrides: { '@zhin.js/core': '4.0.0', '@zhin.js/cli': '4.0.0' } },
    }, null, 2));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(upgradePackageJson(pkgPath, { toLatest: true, dryRun: false })).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toEqual({ 'zhin.js': '^9.4.2', '@zhin.js/cli': '^9.4.2' });
    expect(pkg.pnpm.overrides).toEqual({ '@zhin.js/core': '^9.4.1', '@zhin.js/cli': '^9.4.2' });
  });

  it.each([
    ['a prerelease of the next major', '^10.0.0-beta.3', false],
    ['a range ahead of a lagging mirror', '^9.9.0', false],
    ['a newer pinned release (--include-pinned)', '9.5.0', true],
  ])('never downgrades %s to the registry latest', (_label, existing, includePinned) => {
    const pkgPath = path.join(tmp, 'package.json');
    const original = JSON.stringify({
      name: 'demo',
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin start --foreground --watch source config', start: 'zhin start --foreground --mode production --no-watch', stop: 'zhin stop', preview: 'zhin preview', build: 'tsc --noEmit' },
      dependencies: { 'zhin.js': existing, '@zhin.js/agent': existing },
    }, null, 2);
    fs.writeFileSync(pkgPath, original);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned })).toBe(false);
    expect(fs.readFileSync(pkgPath, 'utf8')).toBe(original);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain(`zhin.js: ${existing} 不低于 registry 最新版本 9.4.2，保留`);
    expect(output).toContain(`@zhin.js/agent: ${existing} 不低于 registry 最新版本 9.4.2，保留`);
  });

  it('upgrades every pnpm workspace package, exact pins too, and skips workspace:/link:/file: (#1250 migrate-skips-workspace-packages)', () => {
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n  - 'packages/**'\n  - '!packages/**/fixtures/**'\n");
    const write = (dir: string, manifest: object) => {
      fs.mkdirSync(path.join(tmp, dir), { recursive: true });
      fs.writeFileSync(path.join(tmp, dir, 'package.json'), JSON.stringify(manifest, null, 2));
    };
    write('plugins/foo', { name: 'foo', dependencies: { 'zhin.js': '1.2.0', '@zhin.js/command': '~1.2.2' }, devDependencies: { '@zhin.js/core': 'workspace:*' } });
    write('plugins/bar', { name: 'bar', dependencies: { 'zhin.js': 'link:../../zhin', '@zhin.js/ai': 'file:../ai', 'left-pad': '1.0.0' } });
    write('plugins/none', { name: 'none', dependencies: { 'left-pad': '1.0.0' } });
    write('packages/a/b', { name: 'deep', dependencies: { 'zhin.js': '^1.0.0' } });
    write('packages/a/fixtures/c', { name: 'fixture', dependencies: { 'zhin.js': '^1.0.0' } });
    fs.mkdirSync(path.join(tmp, 'plugins', 'empty'), { recursive: true });
    expect(listWorkspacePackageDirs(tmp).map(dir => path.relative(tmp, dir).split(path.sep).join('/')))
      .toEqual(['packages/a/b', 'plugins/bar', 'plugins/foo', 'plugins/none']);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const releases = new Map<string, string>();
    const changed = upgradeWorkspacePackages(tmp, { dryRun: false, lookup: cachedRegistryLookup(npmRegistryLookup), releases });
    expect(changed).toEqual(['packages/a/b', 'plugins/foo']);
    const foo = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins/foo/package.json'), 'utf8'));
    expect(foo.dependencies).toEqual({ 'zhin.js': '9.4.2', '@zhin.js/command': '^9.4.2' });
    expect(foo.devDependencies).toEqual({ '@zhin.js/core': 'workspace:*' });
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'plugins/bar/package.json'), 'utf8')).dependencies)
      .toEqual({ 'zhin.js': 'link:../../zhin', '@zhin.js/ai': 'file:../ai', 'left-pad': '1.0.0' });
    // A member never gets the root's scripts / engines.
    expect(foo.scripts).toBeUndefined();
    expect(foo.engines).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'packages/a/fixtures/c/package.json'), 'utf8')).dependencies['zhin.js']).toBe('^1.0.0');
    expect(releases.get('@zhin.js/command')).toBe('9.4.2');
    // One registry query per package for the whole workspace.
    expect(registry.calls.filter(call => call === 'zhin.js@latest')).toHaveLength(1);
  });

  it('keeps a member on the root\'s lock: a root pin without --include-pinned moves neither the member nor the overrides (#1250 review)', () => {
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\noverrides:\n  '@zhin.js/core': 1.1.0\n");
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'demo', engines: { node: '>=22.19.0' },
      dependencies: { 'zhin.js': '1.1.6', '@zhin.js/agent': '^1.1.0' },
      pnpm: { overrides: { '@zhin.js/core': '1.1.0' } },
    }, null, 2));
    fs.mkdirSync(path.join(tmp, 'plugins', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugins', 'foo', 'package.json'), JSON.stringify({
      name: 'foo', dependencies: { 'zhin.js': '~1.1.0', '@zhin.js/agent': '1.1.0', '@zhin.js/command': '1.0.0' },
    }, null, 2));
    registry.zhinDependencies = { '@zhin.js/core': '1.1.6' };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = upgradeProjectDependencies(tmp, { dryRun: false });
      const root = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
      const member = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', 'foo', 'package.json'), 'utf8'));
      // The root keeps its lock; the member's zhin.js stays as well (no move past the root).
      expect(root.dependencies['zhin.js']).toBe('1.1.6');
      expect(member.dependencies['zhin.js']).toBe('~1.1.0');
      // Packages the root upgraded move in the member too; member-only ones follow the registry.
      expect(root.dependencies['@zhin.js/agent']).toBe('^9.4.2');
      expect(member.dependencies['@zhin.js/agent']).toBe('9.4.2');
      expect(member.dependencies['@zhin.js/command']).toBe('9.4.2');
      // Overrides follow the root's own target (its pinned zhin.js 1.1.6), never a member's.
      expect(root.pnpm.overrides['@zhin.js/core']).toBe('1.1.6');
      expect(yaml.parse(fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8')).overrides['@zhin.js/core']).toBe('1.1.6');
      expect(registry.calls).not.toContain('zhin.js@9.4.2');
      expect(result.updatedFiles).toEqual(['package.json', 'plugins/foo/package.json', 'pnpm-workspace.yaml']);
      expect(log.mock.calls.flat().join('\n')).toContain('根目录保留了 zhin.js 的当前版本');
    } finally {
      registry.zhinDependencies = { '@zhin.js/core': '^9.4.1', '@zhin.js/ai': '^9.4.0' };
    }
  });

  it('matches pnpm workspace globs', () => {
    expect(workspaceGlobToRegExp('plugins/*').test('plugins/foo')).toBe(true);
    expect(workspaceGlobToRegExp('plugins/*').test('plugins/foo/bar')).toBe(false);
    expect(workspaceGlobToRegExp('packages/**').test('packages/a/b')).toBe(true);
    expect(workspaceGlobToRegExp('./apps/web/').test('apps/web')).toBe(true);
    expect(workspaceGlobToRegExp('**/fixtures/**').test('packages/a/fixtures/c')).toBe(true);
  });

  it('expands {a,b} in workspace globs like check-release-plan', () => {
    expect(expandWorkspaceBraces('plugins/{foo,bar}')).toEqual(['plugins/foo', 'plugins/bar']);
    expect(expandWorkspaceBraces('{apps,libs}/{x, y}')).toEqual(['apps/x', 'apps/y', 'libs/x', 'libs/y']);
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/{foo,bar}'\n  - '!plugins/{bar}'\n");
    for (const name of ['foo', 'bar', 'baz']) {
      fs.mkdirSync(path.join(tmp, 'plugins', name), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'plugins', name, 'package.json'), '{}');
    }
    expect(listWorkspacePackageDirs(tmp).map(dir => path.basename(dir))).toEqual(['foo']);
  });

  it('never writes a member package.json that is a symbolic link', () => {
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'plugins/*'\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-outside-'));
    try {
      const target = path.join(outside, 'package.json');
      const original = JSON.stringify({ name: 'outside', dependencies: { 'zhin.js': '1.0.0' } });
      fs.writeFileSync(target, original);
      fs.mkdirSync(path.join(tmp, 'plugins', 'linked'), { recursive: true });
      fs.symlinkSync(target, path.join(tmp, 'plugins', 'linked', 'package.json'));
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(upgradeWorkspacePackages(tmp, { dryRun: false, lookup: cachedRegistryLookup(npmRegistryLookup) })).toEqual([]);
      expect(fs.readFileSync(target, 'utf8')).toBe(original);
      expect(log.mock.calls.flat().join('\n')).toContain('是符号链接，已跳过');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('aligns @zhin.js/* in pnpm-workspace.yaml overrides and keeps comments (#1250 migrate-ignores-overrides)', () => {
    const file = path.join(tmp, 'pnpm-workspace.yaml');
    fs.writeFileSync(file, [
      'packages:', "  - 'plugins/*'", '# keep me', 'overrides:', "  '@zhin.js/core': 1.1.0", "  '@zhin.js/local': link:../local",
      "  'left-pad': 1.0.0", 'allowBuilds:', '  esbuild: true', '',
    ].join('\n'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const lookup = cachedRegistryLookup(npmRegistryLookup);
    const resolved = new Map([['zhin.js', '^9.4.2']]);
    expect(syncWorkspaceYamlOverrides(tmp, '^1.0.0', resolved, lookup, true)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain("'@zhin.js/core': 1.1.0");
    expect(syncWorkspaceYamlOverrides(tmp, '^1.0.0', resolved, lookup, false)).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('# keep me');
    expect(yaml.parse(text)).toMatchObject({
      overrides: { '@zhin.js/core': '^9.4.1', '@zhin.js/local': 'link:../local', 'left-pad': '1.0.0' },
      allowBuilds: { esbuild: true },
    });
    expect(syncWorkspaceYamlOverrides(tmp, '^1.0.0', resolved, lookup, false)).toBe(false);
  });

  it('the root upgrade syncs pnpm-workspace.yaml overrides too', () => {
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "overrides:\n  '@zhin.js/ai': 1.0.0\n");
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'demo', engines: { node: '>=22.19.0' }, dependencies: { 'zhin.js': '^1.1.0' } }, null, 2));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(yaml.parse(fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8')).overrides).toEqual({ '@zhin.js/ai': '^9.4.0' });
  });

  it('isNewerThanRelease compares the lowest admitted version with the registry latest', () => {
    expect(isNewerThanRelease('^9.4.2', '9.4.2')).toBe(false);
    expect(isNewerThanRelease('^9.0.0', '9.4.2')).toBe(false);
    expect(isNewerThanRelease('~9.5.0', '9.4.2')).toBe(true);
    expect(isNewerThanRelease('9.4.3-rc.1', '9.4.2')).toBe(true);
    expect(isNewerThanRelease('9.4.2-rc.1', '9.4.2')).toBe(false);
    for (const opaque of ['latest', 'next', 'link:../x', 'github:zhinjs/zhin', '*']) {
      expect(isNewerThanRelease(opaque, '9.4.2'), opaque).toBe(false);
    }
  });

  it('isPinnedSpecifier 区分锁定与跟随上游的写法', () => {
    for (const pinned of ['1.1.6', '=1.2.3', 'v1.0.0', '1.2.0-beta.1', 'link:../x', 'file:../x', 'npm:zhin.js@1.0.0', 'github:zhinjs/zhin', 'https://x/y.tgz', './vendor/x.tgz']) {
      expect(isPinnedSpecifier(pinned), pinned).toBe(true);
    }
    for (const floating of ['^1.1.0', '~1.1.0', '>=1.0.0', '*', 'latest', 'next', '1.x']) {
      expect(isPinnedSpecifier(floating), floating).toBe(false);
    }
  });

  it('isLocalDependencySpecifier / isPinnedSpecifier 识别 gitlab:、bitbucket:、gist:、jsr: 与 user/repo#ref 简写，不误伤范围与 dist-tag (#1250 B-7)', () => {
    const sources = ['gitlab:me/repo', 'bitbucket:me/repo#v1', 'gist:11081aaa', 'jsr:@std/path@^1.0.0', 'zhinjs/zhin', 'zhinjs/zhin#main', 'zhinjs/zhin#semver:^1.0.0', ' user/repo.js#v1.2.3 ', 'workspace:*', 'catalog:', 'npm:zhin.js@1.0.0', 'git+ssh://git@github.com/a/b.git', '../x', '/abs/x'];
    for (const source of sources) expect(isLocalDependencySpecifier(source), source).toBe(true);
    for (const source of sources.filter(value => !value.startsWith('workspace:'))) expect(isPinnedSpecifier(source), source).toBe(true);
    for (const range of ['^1.1.0', '~1.1.0', '>=1.0.0 <2.0.0', '1.x || 2.x', '*', 'latest', 'next', '1.2.3', '@scope/name', 'beta']) {
      expect(isLocalDependencySpecifier(range), range).toBe(false);
    }
  });

  it('将失效的 zhin dev/build 与旧的前台 zhin start 改写为推荐入口，保留 zhin runtime start 与自定义 zhin start', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      dependencies: { 'zhin.js': '1.0.0' },
      scripts: {
        dev: 'zhin dev',
        start: 'zhin start',
        daemon: 'zhin runtime start --daemon',
        build: 'zhin build',
      },
    }, null, 2));

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned: true });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.scripts).toMatchObject({
      // `zhin dev` is the link / unlink tool now.
      dev: 'zhin start --foreground --watch source config',
      // A bare `zhin start` used to stay attached; it backgrounds now, so `start` is rewritten
      // to the foreground form process managers need (ADR 0054 §6).
      start: 'zhin start --foreground --mode production --no-watch',
      // `zhin runtime start` is an accepted alias and is never rewritten.
      daemon: 'zhin runtime start --daemon',
      build: 'tsc --noEmit',
    });
  });

  it('保留带参数的自定义 zhin start 脚本', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      dependencies: { 'zhin.js': '1.0.0' },
      scripts: { start: 'zhin start --foreground --mode production', daemon: 'zhin start --daemon' },
    }, null, 2));
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned: true });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.scripts.start).toBe('zhin start --foreground --mode production');
    expect(pkg.scripts.daemon).toBe('zhin start --daemon');
  });

  it('补齐缺失的启动 scripts（zhin start）', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'demo', dependencies: { 'zhin.js': '1.0.0' } }, null, 2));
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned: true });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    // Exactly the scripts of a new create-zhin-app project: no `daemon` (#1250).
    expect(pkg.scripts).toEqual({
      dev: 'zhin start --foreground --watch source config',
      start: 'zhin start --foreground --mode production --no-watch',
      stop: 'zhin stop',
      preview: 'zhin preview',
      build: 'tsc --noEmit',
    });
  });

  it('isOldChineseTemplate 需同时命中多个特异短语', () => {
    // 旧模板：命中 ≥2 个特异短语
    expect(isOldChineseTemplate('# Soul\n\n我是一个能力出众、行动导向的 AI 助手。\n')).toBe(true);
    expect(isOldChineseTemplate('# Tools\n\n## 工具使用原则\n\n### 调用风格\n')).toBe(true);
    // 单个高频词/短语不误伤
    expect(isOldChineseTemplate('# 笔记\n\n关于记忆与工具组合的心得\n')).toBe(false);
    expect(isOldChineseTemplate('我是一个能力出众的人\n')).toBe(false);
  });

  it('upgradeBootstrapFiles 覆盖前备份 .bak', () => {
    const oldSoul = '# Soul\n\n我是一个能力出众、行动导向的 AI 助手。\n';
    fs.writeFileSync(path.join(tmp, 'SOUL.md'), oldSoul);
    const upgraded = upgradeBootstrapFiles(tmp, false);
    expect(upgraded).toBeGreaterThan(0);
    const next = fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf-8');
    expect(next).toBe(SOUL_MD_TEMPLATE);
    expect(fs.readFileSync(path.join(tmp, 'TOOLS.md'), 'utf-8')).toBe(TOOLS_MD_TEMPLATE);
    // 旧内容被备份
    expect(fs.readFileSync(path.join(tmp, 'SOUL.md.bak'), 'utf-8')).toBe(oldSoul);
  });

  it('upgradeBootstrapFiles 不误伤用户自定义文件', () => {
    const custom = '# 我的 SOUL\n\n这里记录记忆与工具组合的用法。\n';
    fs.writeFileSync(path.join(tmp, 'SOUL.md'), custom);
    upgradeBootstrapFiles(tmp, false);
    expect(fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf-8')).toBe(custom);
    expect(fs.existsSync(path.join(tmp, 'SOUL.md.bak'))).toBe(false);
  });
});

describe('migrate: build scripts of the gateway native dependencies (#1250)', () => {
  const botPackage = (extra: Record<string, unknown> = {}) => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'bot',
      private: true,
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin start --foreground --watch source config', start: 'zhin start --foreground --mode production --no-watch', stop: 'zhin stop', build: 'tsc --noEmit' },
      dependencies: { 'zhin.js': '^9.4.2', '@zhin.js/cli': '^9.4.2', '@zhin.js/gateway': '~9.4.0' },
      ...extra,
    }, null, 2));
    return pkgPath;
  };
  const workspace = () => yaml.parse(fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8'));

  it('appends the missing allowBuilds entries and keeps the existing workspace settings and comments', () => {
    const pkgPath = botPackage();
    fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    const original = "# project workspace\npackages:\n  - '.'\n  - 'plugins/*'\nminimumReleaseAge: 1440\nallowBuilds:\n  esbuild: true\n  node-pty: true\n";
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), original);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: true });
    expect(fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8')).toBe(original);
    const preview = log.mock.calls.flat().join('\n');
    expect(preview).toContain('[dry-run] pnpm-workspace.yaml allowBuilds.ssh2: true');
    expect(preview).toContain('[dry-run] pnpm-workspace.yaml allowBuilds.cpu-features: true');
    expect(preview).not.toContain('allowBuilds.node-pty');

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const written = fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain('# project workspace');
    expect(workspace()).toEqual({
      packages: ['.', 'plugins/*'],
      minimumReleaseAge: 1440,
      allowBuilds: { esbuild: true, 'node-pty': true, ssh2: true, 'cpu-features': true },
      minimumReleaseAgeExclude: ['@zhin.js/cli@9.4.2', '@zhin.js/gateway@9.4.2', 'zhin.js@9.4.2'],
    });
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf8'))).not.toHaveProperty('pnpm');

    // A second run has nothing left to add.
    log.mockClear();
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: true });
    expect(log.mock.calls.flat().join('\n')).not.toContain('allowBuilds');
  });

  it('creates pnpm-workspace.yaml for a pnpm project without one and keeps an explicit denial', () => {
    const pkgPath = botPackage({ packageManager: 'pnpm@11.27.1' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(workspace()).toEqual({ allowBuilds: { 'node-pty': true, ssh2: true, 'cpu-features': true }, minimumReleaseAgeExclude: ['@zhin.js/cli@9.4.2', '@zhin.js/gateway@9.4.2', 'zhin.js@9.4.2'], });

    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'allowBuilds:\n  node-pty: false\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(workspace().allowBuilds).toEqual({ 'node-pty': false, ssh2: true, 'cpu-features': true });
    expect(log.mock.calls.flat().join('\n')).toContain('allowBuilds.node-pty 为 false（项目已拒绝），保留');
  });

  it('does not create pnpm-workspace.yaml unless pnpm 10+ is confirmed (pnpm 9 rejects a file without packages)', () => {
    const pkgPath = botPackage({ packageManager: 'pnpm@9.15.4' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(fs.existsSync(path.join(tmp, 'pnpm-workspace.yaml'))).toBe(false);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('未确认 pnpm >= 10，未创建 pnpm-workspace.yaml');
    expect(output).not.toContain('allowBuilds.node-pty: true');
  });

  it('fills an empty allowBuilds key and keeps long strings on one line', () => {
    const pkgPath = botPackage();
    const long = 'x'.repeat(120);
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), `packages:\n  - '.'\nminimumReleaseAge: 1440\ncatalog:\n  foo: "${long} ${long}"\nallowBuilds:\n`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const written = fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).toContain(`  foo: "${long} ${long}"\n`);
    expect(workspace()).toEqual({
      packages: ['.'],
      minimumReleaseAge: 1440,
      catalog: { foo: `${long} ${long}` },
      allowBuilds: { 'node-pty': true, ssh2: true, 'cpu-features': true },
      // A project that sets minimumReleaseAge also lists the upgrade targets (#1250).
      minimumReleaseAgeExclude: ['@zhin.js/cli@9.4.2', '@zhin.js/gateway@9.4.2', 'zhin.js@9.4.2'],
    });
  });

  it('appends to existing onlyBuiltDependencies lists, and adds one for pnpm releases before allowBuilds', () => {
    const pkgPath = botPackage({ packageManager: 'pnpm@10.12.1', pnpm: { onlyBuiltDependencies: ['esbuild', 'node-pty'] } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(upgradePackageJson(pkgPath, { toLatest: true, dryRun: false })).toBe(true);
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).pnpm.onlyBuiltDependencies).toEqual(['esbuild', 'node-pty', 'ssh2', 'cpu-features']);
    // pnpm 10 builds every gateway package from the onlyBuiltDependencies lists it reads (node-pty
    // already listed, ssh2 / cpu-features appended): no allowBuilds key for any of them, and no
    // release-age exclusions without minimumReleaseAge (#1250).
    expect(workspace()).toEqual({
      onlyBuiltDependencies: ['node-pty', 'ssh2', 'cpu-features'],
    });

    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - sharp\n  - ssh2\n');
    botPackage({ packageManager: 'pnpm@11.27.1' });
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(workspace().onlyBuiltDependencies).toEqual(['sharp', 'ssh2', 'node-pty', 'cpu-features']);
  });

  it('replaces the placeholder pnpm 11 writes for ignored build scripts', () => {
    const pkgPath = botPackage({ packageManager: 'pnpm@11.27.1' });
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'allowBuilds:\n  cpu-features: set this to true or false\n  esbuild: true\n  node-pty: set this to true or false\n  ssh2: false\n');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const written = fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8');
    expect(written).not.toContain('set this to true or false');
    expect(workspace().allowBuilds).toEqual({ 'cpu-features': true, esbuild: true, 'node-pty': true, ssh2: false });
  });

  it('keeps release-age exclusions that already cover a release and skips pinned packages', () => {
    const pkgPath = botPackage({ packageManager: 'pnpm@11.27.1' });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.dependencies['@zhin.js/adapter-icqq'] = '1.0.0';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg));
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "minimumReleaseAgeExclude:\n  - '@zhin.js/*'\n");
    vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(workspace().minimumReleaseAgeExclude).toEqual(['@zhin.js/*', 'zhin.js@9.4.2']);
  });

  it('leaves npm projects and projects without the gateway alone', () => {
    const pkgPath = botPackage();
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), '{}');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(fs.existsSync(path.join(tmp, 'pnpm-workspace.yaml'))).toBe(false);

    fs.rmSync(path.join(tmp, 'package-lock.json'));
    fs.rmSync(path.join(tmp, 'zhin.config.yml'));
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'plugin', dependencies: { 'zhin.js': '^9.4.2' } }));
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(fs.existsSync(path.join(tmp, 'pnpm-workspace.yaml'))).toBe(false);
  });
});

describe('schedule (running Host)', () => {
  let requests: { url: string; method: string; body: any }[];
  function stubHost(reply: (path: string) => { status: number; body: unknown }) {
    requests = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method: init?.method ?? 'GET', body });
      const { status, body: payload } = reply(new URL(url).pathname);
      return { ok: status < 400, status, json: async () => payload } as Response;
    }));
  }
  beforeEach(() => {
    gateway.running = true;
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'http:\n  port: 9321\n  token: secret\n');
    stubHost(() => ({ status: 201, body: { success: true, data: { job: { id: 'sched_1' } } } }));
  });
  afterEach(() => { gateway.running = false; vi.unstubAllGlobals(); });

  it('without this project\'s gateway it exits 1 without calling the configured port (#1250)', async () => {
    gateway.running = false;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    for (const args of [['list'], ['remove', 'j1'], ['add', '--every', '30m', '--prompt', 'hi']]) {
      await expect(scheduleCommand.parseAsync(['node', 'zhin', ...args])).rejects.toThrow('process.exit:1');
    }
    expect(requests).toHaveLength(0);
    const text = [...errors.mock.calls, ...stderr.mock.calls].map(call => String(call[0])).join('\n');
    expect(text).toContain('本项目的网关未运行');
  });

  it('--every + --prompt 通过 Host 添加，且不写 data/schedule-jobs.json', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '30m', '--prompt', '检查待办']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'http://127.0.0.1:9321/api/assistant/jobs', method: 'POST' });
    expect(requests[0].body.schedule).toEqual({ kind: 'every', everyMs: 30 * 60 * 1000 });
    expect(requests[0].body.prompt).toBe('检查待办');
    expect(requests[0].body.notify).toEqual({ channel: 'silent' });
    expect(fs.existsSync(path.join(tmp, 'data', 'schedule-jobs.json'))).toBe(false);
  });

  it('--at + --prompt 可正常添加', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '--at', '2099-12-31T09:00:00Z', '--prompt', '年终提醒']);
    expect(requests[0].body.schedule.kind).toBe('at');
    expect(requests[0].body.prompt).toBe('年终提醒');
  });

  it('cron 位置参数 + --prompt 仍可添加', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '0 0 9 * * *', '--prompt', '早报']);
    expect(requests[0].body.schedule).toEqual({ kind: 'solar', cron: '0 0 9 * * *' });
  });

  it('remove / pause / resume 发往对应的 Host 路由', async () => {
    stubHost(() => ({ status: 200, body: { success: true, data: { id: 'j1' } } }));
    for (const action of ['remove', 'pause', 'resume']) {
      await scheduleCommand.parseAsync(['node', 'zhin', action, 'j1']);
    }
    expect(requests.map((request) => [new URL(request.url).pathname, request.body])).toEqual([
      ['/api/assistant/jobs/remove', { id: 'j1' }],
      ['/api/assistant/jobs/pause', { id: 'j1' }],
      ['/api/assistant/jobs/resume', { id: 'j1' }],
    ]);
  });

  it('a disabled assistant names the reason for list (200 state) and writes (404 legacy string) (#1250)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    const disabled = { status: 'disabled', reason: 'agent-not-installed', message: '未安装 AI 智能体（@zhin.js/agent）：运行 zhin setup --ai' };
    stubHost(() => ({ status: 200, body: { success: true, data: { ...disabled, jobs: [] } } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'list'])).rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith(`${disabled.message}；无法列出调度任务`);
    stubHost(() => ({ status: 404, body: { success: false, code: 'unavailable', error: 'assistant.enabled is false', data: disabled } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'pause', 'j1'])).rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith(`${disabled.message}；无法管理调度任务`);
  });

  it('Host 拒绝时退出码为 1', async () => {
    stubHost(() => ({ status: 404, body: { success: false, error: '任务不存在: ghost' } }));
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'remove', 'ghost'])).rejects.toThrow('process.exit:1');
  });

  it('非法 --every 统一走 logger.error + exit(1)，不发请求', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    await expect(
      scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', 'xyz', '--prompt', 'hi']),
    ).rejects.toThrow('process.exit:1');
    expect(requests).toHaveLength(0);
  });

  it('缺少 --prompt 时报错退出', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    await expect(
      scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '30m']),
    ).rejects.toThrow('process.exit:1');
    expect(requests).toHaveLength(0);
  });

  it('list 显示解析出的投递目标、无效目标标记与下次运行时间 (#1250)', async () => {
    stubHost(() => ({ status: 200, body: { success: true, data: { jobs: [
      { id: 'weather', label: '天气早报', enabled: true, schedule: { kind: 'workday', cron: '0 0 9 * * *' },
        action: { kind: 'agent', prompt: '天气' }, notify: { channel: 'im' }, createdAt: 1, updatedAt: 1,
        state: {}, target: { resolved: false, reason: 'endpoint_not_found', display: 'gone（sandbox）· 私聊 u1' } },
      { id: 'brief', enabled: true, schedule: { kind: 'solar', cron: '0 0 8 * * *' },
        action: { kind: 'agent', prompt: '早报' }, notify: { channel: 'im' }, createdAt: 1, updatedAt: 1,
        state: { nextRunAtMs: Date.UTC(2026, 10, 16, 0) }, target: { resolved: true, display: 'sandbox-bot（sandbox）· 私聊 u1' } },
    ] } } }));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    await scheduleCommand.parseAsync(['node', 'zhin', 'list']);
    const output = lines.join('\n');
    expect(output).toContain('⚠ 无效：目标账号不存在（gone（sandbox）· 私聊 u1）');
    expect(output).toContain('⚠ 无（不会触发）');
    expect(output).toContain('sandbox-bot（sandbox）· 私聊 u1');
    // `YYYY-MM-DD HH:mm:ss`, 24-hour, local time (#1250 cli-datetime-us-locale).
    expect(output).toContain(`下次:   ${formatDateTime(Date.UTC(2026, 10, 16, 0))}`);
    expect(output).not.toMatch(/\b[AP]M\b/u);
  });

  it('list 缩进多行内容、超过 2 行截断并提示 --json；--json 输出完整内容 (#1250)', async () => {
    const prompt = '第一行\n第二行\n第三行';
    stubHost(() => ({ status: 200, body: { success: true, data: { jobs: [
      { id: 'multi', enabled: false, schedule: { kind: 'solar', cron: '0 0 8 * * *' },
        action: { kind: 'agent', prompt }, notify: { channel: 'log' }, createdAt: 1, updatedAt: 1, state: {} },
    ] } } }));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    await scheduleCommand.parseAsync(['node', 'zhin', 'list']);
    const text = lines.join('\n');
    expect(text).toContain('    内容:   第一行\n            第二行\n            …（共 3 行，完整内容用 zhin schedule list --json 查看）');
    expect(text).not.toContain('第三行');
    lines.length = 0;
    await scheduleCommand.parseAsync(['node', 'zhin', 'list', '--json']);
    expect(JSON.parse(lines.join('\n'))[0].action.prompt).toBe(prompt);
  });

  it('--target 格式无效时不发请求 (#1250)', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    await expect(
      scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '30m', '--prompt', 'hi', '--target', 'sandbox:bot']),
    ).rejects.toThrow('process.exit:1');
    expect(requests).toHaveLength(0);
  });

  it('--target 发送 im 投递目标，渠道默认为 im (#1250)', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '30m', '--prompt', 'hi', '--target', 'sandbox:sandbox-bot:private:u1']);
    expect(requests[0].body.notify).toEqual({ channel: 'im', target: 'sandbox:sandbox-bot:private:u1' });
  });

  it('add 不带 --agent 时请求体没有 agent 字段（行为与以前相同）(#1250 b52)', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '1h', '--prompt', '早报']);
    expect(requests[0].body).not.toHaveProperty('agent');
  });

  it('add --agent 把 Agent 名称发给 Host；Host 拒绝不存在的 Agent 时退出码为 1 并显示可用 Agent (#1250 b52)', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '1h', '--prompt', '早报', '--agent', 'news']);
    expect(requests[0].body.agent).toBe('news');
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    stubHost(() => ({ status: 400, body: { success: false, code: 'schedule_agent_not_found', error: 'Agent 不存在：ghost。可用的 Agent：zhin、news' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '1h', '--prompt', '早报', '--agent', 'ghost']))
      .rejects.toThrow('process.exit:1');
    expect(error.mock.calls.map(call => String(call[0])).join('\n')).toContain('可用的 Agent：zhin、news');
  });

  it('set-agent 修改任务的 Agent，--clear 发送 null；缺少名称时不发请求 (#1250 b52)', async () => {
    stubHost(() => ({ status: 200, body: { success: true, data: { job: { id: 'j1' } } } }));
    await scheduleCommand.parseAsync(['node', 'zhin', 'set-agent', 'j1', 'news']);
    expect(requests.map(request => [new URL(request.url).pathname, request.body])).toEqual([
      ['/api/assistant/jobs/set-agent', { id: 'j1', agent: 'news' }],
    ]);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'set-agent', 'j1'])).rejects.toThrow('process.exit:1');
    expect(requests).toHaveLength(1);
    await scheduleCommand.parseAsync(['node', 'zhin', 'set-agent', 'j1', '--clear']);
    expect(requests[1].body).toEqual({ id: 'j1', agent: null });
  });

  it('update 只发送指定的修改并输出新的计划；Agent 等保持不变 (#1250 b90)', async () => {
    stubHost(() => ({ status: 200, body: { success: true, data: { job: {
      id: 'brief', label: '早报', enabled: true, schedule: { kind: 'solar', cron: '0 0 8 * * *' },
      action: { kind: 'agent', prompt: '早报', agent: 'briefing' }, notify: { channel: 'silent' }, createdAt: 1, updatedAt: 2,
      state: { nextRunAtMs: Date.UTC(2026, 10, 24, 0) } } } } }));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    await scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '--cron', '0 8 * * *']);
    await scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '--kind', 'workday', '--label', '每日早报', '--disable']);
    await scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '0 0 7 * * *', '--enable', '--label', '']);
    await scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '--every', '1h']);
    expect(requests.map(request => [new URL(request.url).pathname, request.body])).toEqual([
      ['/api/assistant/jobs/update', { id: 'brief', schedule: { cron: '0 0 8 * * *' } }],
      ['/api/assistant/jobs/update', { id: 'brief', schedule: { kind: 'workday' }, label: '每日早报', enabled: false }],
      ['/api/assistant/jobs/update', { id: 'brief', schedule: { cron: '0 0 7 * * *' }, label: null, enabled: true }],
      ['/api/assistant/jobs/update', { id: 'brief', schedule: { kind: 'every', everyMs: 60 * 60 * 1000 } }],
    ]);
    const output = lines.join('\n');
    expect(output).toContain('已更新任务: brief（Agent、提示词与投递目标保持不变）');
    expect(output).toContain('计划:   solar 0 0 8 * * *');
    expect(output).toContain(`下次:   ${formatDateTime(Date.UTC(2026, 10, 24, 0))}`);
  });

  it('update 参数无效时不发请求；Host 拒绝时说明原因并以 1 退出 (#1250 b90)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    const invalid: [string[], string][] = [
      [['update', 'brief'], '请至少指定一项修改'],
      [['update', 'brief', '--enable', '--disable'], '--enable 与 --disable 只能二选一'],
      [['update', 'brief', '--cron', '0 8 * * *', '--every', '1h'], '只能选一种'],
      [['update', 'brief', '--kind', 'weekly'], '--kind 无效'],
      [['update', 'brief', '--cron', '8 * *'], 'cron 须为 5 或 6 段'],
      [['update', 'brief', '--at', '2000-01-01T00:00:00Z'], '--at 必须是未来'],
    ];
    for (const [args, message] of invalid) {
      await expect(scheduleCommand.parseAsync(['node', 'zhin', ...args])).rejects.toThrow('process.exit:1');
      expect(String(error.mock.calls.at(-1)?.[0])).toContain(message);
    }
    expect(requests).toHaveLength(0);
    stubHost(() => ({ status: 404, body: { success: false, code: 'not_found', error: '任务不存在: ghost' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'update', 'ghost', '--disable'])).rejects.toThrow('process.exit:1');
    expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/api/assistant/jobs/update']);
    stubHost(() => ({ status: 403, body: { success: false, code: 'schedule_target_forbidden',
      error: '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '--cron', '0 8 * * *'])).rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith('无法修改任务 brief：你没有权限向它的投递目标发消息（需要 icqq / bot-1 上的 endpoint.operate）');
    expect(info.mock.calls.map(call => String(call[0])).join('\n')).toContain('--disable');
    // A label change on a job that stays enabled needs the same permission: the hint says so.
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '--label', '新标签'])).rejects.toThrow('process.exit:1');
    expect(String(info.mock.calls.at(-1)?.[0])).toContain('改标签');
    expect(String(info.mock.calls.at(-1)?.[0])).toContain('只有停用任务（--disable）不需要');
  });

  it('update：--kind 不区分大小写并支持 holiday；打印实例返回的 warning (#1250 b90 review)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    stubHost(() => ({ status: 200, body: { success: true, data: {
      job: { id: 'brief', enabled: true, schedule: { kind: 'holiday', cron: '0 0 9 * * *' }, action: { kind: 'agent', prompt: '早报' },
        notify: { channel: 'silent' }, createdAt: 1, updatedAt: 2, state: {} },
      warning: '任务已启用，但按新计划算不出下次运行时间，它不会自动执行；请检查 cron 或改用其他计划' } } }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '--kind', 'HOLIDAY']);
    await scheduleCommand.parseAsync(['node', 'zhin', 'update', 'brief', '--kind', 'freeday']);
    expect(requests.map(request => request.body.schedule)).toEqual([{ kind: 'holiday' }, { kind: 'freeDay' }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('算不出下次运行时间'));
    // add: the same kinds.
    stubHost(() => ({ status: 201, body: { success: true, data: { job: { id: 'sched_1' } } } }));
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '0 0 9 * * *', '--kind', 'Holiday', '--prompt', '节日']);
    expect(requests[0]!.body.schedule).toEqual({ kind: 'holiday', cron: '0 0 9 * * *' });
  });

  it('update：实例以 400 schedule_invalid 拒绝计划时说明原因、提示改回 solar 要给完整 cron，并以 1 退出 (#1250 b90 review)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    stubHost(() => ({ status: 400, body: { success: false, code: 'schedule_invalid',
      error: 'cron 表达式无效: Calendar cron requires * for day, month, and weekday fields' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'update', 'water', '--cron', '0 0 9 * * 1-5'])).rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith('无法修改任务 water：cron 表达式无效: Calendar cron requires * for day, month, and weekday fields');
    const hints = info.mock.calls.map(call => String(call[0])).join('\n');
    expect(hints).toContain('--kind solar --cron');
    expect(hints).toContain('不会自动恢复');
    // A plain 400 (invalid_argument) shows the instance's explanation as it is.
    stubHost(() => ({ status: 400, body: { success: false, code: 'invalid_argument', error: '计划类型无效: weekly，可选 solar | lunar | workday | freeDay | holiday' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'update', 'water', '--kind', 'solar'])).rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith('计划类型无效: weekly，可选 solar | lunar | workday | freeDay | holiday');
  });

  it('resume 被投递目标拒绝（403 schedule_target_forbidden）时说明原因并以 1 退出 (#1250 b61)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    stubHost(() => ({ status: 403, body: { success: false, code: 'schedule_target_forbidden',
      error: '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'resume', 'j1'])).rejects.toThrow('process.exit:1');
    expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/api/assistant/jobs/resume']);
    expect(error).toHaveBeenLastCalledWith('无法恢复任务 j1：你没有权限向它的投递目标发消息（需要 icqq / bot-1 上的 endpoint.operate）');
    expect(info.mock.calls.map(call => String(call[0])).join('\n')).toContain('zhin schedule remove j1');
    expect(error.mock.calls.flat().join('\n')).not.toContain('schedule_target_forbidden');
  });

  it('describeScheduleRefusal：投递目标被拒、Agent 不存在（含 data.available、为空、旧 Host 仅有文案）(#1250 b61)', () => {
    const refused = (status: number, body: { code?: string; error: string; data?: unknown }) =>
      ({ ok: false as const, status, code: body.code, error: body.error, ...(body.data !== undefined ? { detail: body.data } : {}) });
    const forbidden = refused(403, { code: 'schedule_target_forbidden', error: '投递目标需要指明账号（scene.platform 与 scene.endpointKey）' });
    expect(describeScheduleRefusal(forbidden, { kind: 'resume', id: 'j1' })?.[0]).toBe('无法恢复任务 j1：你没有权限向它的投递目标发消息');
    expect(describeScheduleRefusal(forbidden, { kind: 'set-agent', id: 'j1' })?.[0]).toBe('无法修改任务 j1 的 Agent：你没有权限向它的投递目标发消息');
    expect(describeScheduleRefusal(forbidden, { kind: 'add' })?.[1]).toContain('--target');
    const notFound = (available: string[]) => refused(400, { code: 'schedule_agent_not_found', error: `Agent 不存在：ghost。可用的 Agent：${available.join('、')}`,
      data: { code: 'schedule_agent_not_found', agent: 'ghost', available } });
    expect(describeScheduleRefusal(notFound(['zhin', 'news']), { kind: 'set-agent', id: 'j1' })).toEqual([
      'Agent 不存在：ghost。可用的 Agent：zhin、news',
      '用 zhin schedule set-agent j1 <名称> 改选其中之一，或加 --clear 恢复默认 Agent',
    ]);
    expect(describeScheduleRefusal(notFound([]), { kind: 'add' })).toEqual([
      'Agent 不存在：ghost。当前没有可用的 Agent',
      '请先在配置的 ai.agents 中添加 Agent，或省略 --agent 使用默认 Agent（zhin）',
    ]);
    expect(describeScheduleRefusal(refused(400, { error: 'Agent 不存在：w。可用的 Agent：zhin、a' }), { kind: 'add' })?.[0])
      .toBe('Agent 不存在：w。可用的 Agent：zhin、a');
    expect(describeScheduleRefusal(refused(404, { code: 'not_found', error: '任务不存在: j1' }), { kind: 'resume', id: 'j1' })).toBeUndefined();
  });

  it('set-agent 指定不存在的 Agent 时列出 data.available 并以 1 退出 (#1250 b61)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    stubHost(() => ({ status: 400, body: { success: false, code: 'schedule_agent_not_found', error: 'Agent 不存在：ghost。可用的 Agent：zhin、news',
      data: { code: 'schedule_agent_not_found', agent: 'ghost', available: ['zhin', 'news'] } } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'set-agent', 'j1', 'ghost'])).rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith('Agent 不存在：ghost。可用的 Agent：zhin、news');
    expect(info.mock.calls.map(call => String(call[0])).join('\n')).toContain('zhin schedule set-agent j1 <名称>');
  });

  it('describeScheduleRefusal：账号含 undefined 视为未提取；data.available 无可用名称时退回文案 (#1250 b61)', () => {
    const refused = (status: number, body: { code?: string; error: string; data?: unknown }) =>
      ({ ok: false as const, status, code: body.code, error: body.error, ...(body.data !== undefined ? { detail: body.data } : {}) });
    const legacy = refused(403, { code: 'schedule_target_forbidden', error: '没有向该账号投递的权限：需要 undefined / undefined 上的 endpoint.operate' });
    expect(describeScheduleRefusal(legacy, { kind: 'resume', id: 'j1' })?.[0]).toBe('无法恢复任务 j1：你没有权限向它的投递目标发消息');
    expect(describeScheduleRefusal(legacy, { kind: 'add' })?.join('\n')).not.toContain('undefined');
    const half = refused(403, { code: 'schedule_target_forbidden', error: '没有向该账号投递的权限：需要 icqq / undefined 上的 endpoint.operate' });
    expect(describeScheduleRefusal(half, { kind: 'set-agent', id: 'j1' })?.[0]).toBe('无法修改任务 j1 的 Agent：你没有权限向它的投递目标发消息');
    for (const available of [[], [1, null, '  ']]) {
      expect(describeScheduleRefusal(refused(400, { code: 'schedule_agent_not_found', error: 'Agent 不存在：ghost。可用的 Agent：zhin、news',
        data: { code: 'schedule_agent_not_found', agent: 'ghost', available } }), { kind: 'add' })?.[0]).toBe('Agent 不存在：ghost。可用的 Agent：zhin、news');
    }
    // detail.code wins over the envelope code.
    expect(describeScheduleRefusal(refused(403, { code: 'forbidden', error: '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate',
      data: { code: 'schedule_target_forbidden' } }), { kind: 'add' })?.[0]).toBe('无法创建任务：你没有权限向投递目标发消息（需要 icqq / bot-1 上的 endpoint.operate）');
    expect(describeScheduleRefusal(refused(400, { code: 'schedule_agent_not_found', error: 'x', data: { code: 'invalid_argument' } }), { kind: 'add' }))
      .toBeUndefined();
  });

  it('add 被投递目标拒绝（403）或 Agent 不存在（400）时说明原因并以 1 退出 (#1250 b61)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    stubHost(() => ({ status: 403, body: { success: false, code: 'schedule_target_forbidden',
      error: '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '1h', '--prompt', '早报', '--target', 'icqq:bot-1:group:g1']))
      .rejects.toThrow('process.exit:1');
    expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/api/assistant/jobs']);
    expect(error).toHaveBeenLastCalledWith('无法创建任务：你没有权限向投递目标发消息（需要 icqq / bot-1 上的 endpoint.operate）');
    expect(info.mock.calls.map(call => String(call[0])).join('\n')).toContain('--target');
    info.mockClear();
    stubHost(() => ({ status: 400, body: { success: false, code: 'schedule_agent_not_found', error: 'Agent 不存在：ghost。可用的 Agent：zhin、news',
      data: { code: 'schedule_agent_not_found', agent: 'ghost', available: ['zhin', 'news'] } } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '1h', '--prompt', '早报', '--agent', 'ghost']))
      .rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith('Agent 不存在：ghost。可用的 Agent：zhin、news');
    expect(info.mock.calls.map(call => String(call[0])).join('\n')).toContain('--agent <名称>');
  });

  it('set-agent 被投递目标拒绝时说明原因；--debug 额外输出错误码行 (#1250 b61)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const { setCliFlags } = await import('../src/utils/cli-flags.js');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    stubHost(() => ({ status: 403, body: { success: false, code: 'schedule_target_forbidden',
      error: '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate' } }));
    await expect(scheduleCommand.parseAsync(['node', 'zhin', 'set-agent', 'j1', 'news'])).rejects.toThrow('process.exit:1');
    expect(error).toHaveBeenLastCalledWith('无法修改任务 j1 的 Agent：你没有权限向它的投递目标发消息（需要 icqq / bot-1 上的 endpoint.operate）');
    expect(info.mock.calls.map(call => String(call[0])).join('\n')).not.toContain('错误码');
    info.mockClear();
    setCliFlags({ debug: true });
    try {
      await expect(scheduleCommand.parseAsync(['node', 'zhin', 'set-agent', 'j1', 'news'])).rejects.toThrow('process.exit:1');
    } finally {
      setCliFlags({ debug: false });
    }
    expect(info).toHaveBeenLastCalledWith('  错误码: schedule_target_forbidden（HTTP 403）');
  });

  it('list 显示每个任务用的 Agent，未指定时为默认 (#1250 b52)', async () => {
    stubHost(() => ({ status: 200, body: { success: true, data: { jobs: [
      { id: 'news', enabled: false, schedule: { kind: 'solar', cron: '0 0 8 * * *' },
        action: { kind: 'agent', prompt: '早报', agent: 'news' }, notify: { channel: 'log' }, createdAt: 1, updatedAt: 1, state: {} },
      { id: 'plain', enabled: false, schedule: { kind: 'solar', cron: '0 0 9 * * *' },
        action: { kind: 'agent', prompt: '天气' }, notify: { channel: 'log' }, createdAt: 1, updatedAt: 1, state: {} },
    ] } } }));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    await scheduleCommand.parseAsync(['node', 'zhin', 'list']);
    const text = lines.join('\n');
    expect(text).toContain('    Agent:  news');
    expect(text).toContain('    Agent:  zhin（默认）');
    // An older instance does not send `agents`: nothing is flagged.
    expect(text).not.toContain('Agent 不存在');
  });

  it('list 用 GET 返回的 agents 核对，标出 Agent 已删除的任务 (#1250 b52)', async () => {
    const job = (id: string, agent?: string) => ({ id, enabled: true, schedule: { kind: 'solar', cron: '0 0 8 * * *' },
      action: { kind: 'agent', prompt: 'p', ...(agent ? { agent } : {}) }, notify: { channel: 'log' }, createdAt: 1, updatedAt: 1, state: {} });
    stubHost(() => ({ status: 200, body: { success: true, data: { agents: ['zhin', 'news'], jobs: [job('gone', 'deleted'), job('ok', 'news'), job('plain')] } } }));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    await scheduleCommand.parseAsync(['node', 'zhin', 'list']);
    const agentLines = lines.join('\n').split('\n').filter(line => line.includes('Agent:'));
    expect(agentLines).toEqual([
      expect.stringMatching(/^ {4}Agent: {2}deleted {2}⚠ Agent 不存在/),
      '    Agent:  news',
      '    Agent:  zhin（默认）',
    ]);
  });
});

describe('migrate: release-age exclusions, allowBuilds and retired packages (#1250 retired-package-not-flagged)', () => {
  const bot = (extra: Record<string, unknown> = {}, workspaceText = "packages:\n  - '.'\n") => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'bot',
      private: true,
      engines: { node: '>=22.19.0' },
      scripts: { dev: 'zhin start --foreground --watch source config', start: 'zhin start --foreground --mode production --no-watch', stop: 'zhin stop', build: 'tsc --noEmit' },
      dependencies: { 'zhin.js': '9.4.1', '@zhin.js/cli': '9.4.1', '@zhin.js/gateway': '9.4.1', '@zhin.js/adapter-icqq': '1.0.0' },
      ...extra,
    }, null, 2));
    fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), workspaceText);
    return pkgPath;
  };
  const workspace = () => yaml.parse(fs.readFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'utf8'));
  const run = (pkgPath: string, pnpm: string | undefined) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false, includePinned: true, pnpmVersion: () => pnpm });
    return log.mock.calls.flat().join('\n');
  };

  it('writes no minimumReleaseAgeExclude with --include-pinned when the project sets no minimumReleaseAge (pnpm 10)', () => {
    const output = run(bot(), '10.30.0');
    expect(workspace()).not.toHaveProperty('minimumReleaseAgeExclude');
    expect(output).toContain('项目未设置 minimumReleaseAge（pnpm 10 默认不启用），不写 minimumReleaseAgeExclude');
  });

  it('writes the exclusions where pnpm reads minimumReleaseAge: pnpm-workspace.yaml, .npmrc, package.json#pnpm', () => {
    run(bot({}, "packages:\n  - '.'\nminimumReleaseAge: 1440\n"), '10.30.0');
    expect(workspace().minimumReleaseAgeExclude).toEqual(['@zhin.js/adapter-icqq@9.4.2', '@zhin.js/cli@9.4.2', '@zhin.js/gateway@9.4.2', 'zhin.js@9.4.2']);

    const npmrc = bot();
    fs.writeFileSync(path.join(tmp, '.npmrc'), 'registry=https://registry.npmjs.org/\nminimum-release-age=60\n');
    run(npmrc, '10.30.0');
    expect(workspace().minimumReleaseAgeExclude).toHaveLength(4);
    fs.rmSync(path.join(tmp, '.npmrc'));

    run(bot({ pnpm: { minimumReleaseAge: 30 } }), '10.30.0');
    expect(workspace().minimumReleaseAgeExclude).toHaveLength(4);
  });

  it('reads minimumReleaseAge only from pnpm-workspace.yaml under pnpm 11 (package.json#pnpm and .npmrc are ignored there)', () => {
    // pnpm 11 ignores the package.json pnpm field: its default one-day gate still applies.
    const output = run(bot({ pnpm: { minimumReleaseAge: 0 } }), '11.27.1');
    expect(workspace().minimumReleaseAgeExclude).toHaveLength(4);
    expect(output).not.toContain('不写 minimumReleaseAgeExclude');

    // pnpm 11 reads only auth / registry / TLS / proxy settings from .npmrc.
    const npmrc = bot();
    fs.writeFileSync(path.join(tmp, '.npmrc'), 'minimum-release-age=0\n');
    run(npmrc, '11.27.1');
    expect(workspace().minimumReleaseAgeExclude).toHaveLength(4);
    fs.rmSync(path.join(tmp, '.npmrc'));

    // pnpm 10 still honours both.
    run(bot({ pnpm: { minimumReleaseAge: 0 } }), '10.30.0');
    expect(workspace()).not.toHaveProperty('minimumReleaseAgeExclude');
  });

  it('follows pnpm 11\'s default gate, and an explicit 0 turns it off', () => {
    run(bot(), '11.27.1');
    expect(workspace().minimumReleaseAgeExclude).toHaveLength(4);
    const output = run(bot({}, "packages:\n  - '.'\nminimumReleaseAge: 0\n"), '11.27.1');
    expect(workspace()).not.toHaveProperty('minimumReleaseAgeExclude');
    expect(output).toContain('pnpm-workspace.yaml 的 minimumReleaseAge 为 0（不拦新版本），不写 minimumReleaseAgeExclude');
  });

  it('writes no allowBuilds key under pnpm 10 for any gateway package an onlyBuiltDependencies list covers', () => {
    const output = run(bot({}, "packages:\n  - '.'\nonlyBuiltDependencies:\n  - node-pty\n"), '10.30.0');
    // ssh2 / cpu-features follow the same rule as node-pty: appended to the list pnpm 10 reads.
    expect(workspace()).not.toHaveProperty('allowBuilds');
    expect(workspace().onlyBuiltDependencies).toEqual(['node-pty', 'ssh2', 'cpu-features']);
    expect(output).toContain('node-pty: 已在 pnpm-workspace.yaml onlyBuiltDependencies 中，pnpm 10 会构建它，不再写 allowBuilds');
    expect(output).toContain('ssh2: 加入 pnpm-workspace.yaml onlyBuiltDependencies，pnpm 10 会构建它，不再写 allowBuilds');
    expect(output).toContain('cpu-features: 加入 pnpm-workspace.yaml onlyBuiltDependencies，pnpm 10 会构建它，不再写 allowBuilds');
    expect(output).not.toContain('allowBuilds.');
  });

  it('writes allowBuilds as before when the pnpm version is unknown (it may be pnpm 11)', () => {
    run(bot({}, "packages:\n  - '.'\nonlyBuiltDependencies:\n  - node-pty\n"), undefined);
    expect(workspace().allowBuilds).toEqual({ 'node-pty': true, ssh2: true, 'cpu-features': true });
    expect(workspace().onlyBuiltDependencies).toEqual(['node-pty', 'ssh2', 'cpu-features']);
  });

  it('still writes allowBuilds under pnpm 11, which no longer reads onlyBuiltDependencies', () => {
    run(bot({}, "packages:\n  - '.'\nonlyBuiltDependencies:\n  - node-pty\n"), '11.27.1');
    expect(workspace().allowBuilds).toEqual({ 'node-pty': true, ssh2: true, 'cpu-features': true });
  });

  it('does not upgrade a retired package and lists it with its replacement and the imports to rewrite', () => {
    const pkgPath = bot({ devDependencies: { '@zhin.js/config-yaml': '^1.1.0' } });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'config.ts'), "// '@zhin.js/config-yaml' in a comment\nimport { YamlConfigDocument } from '@zhin.js/config-yaml';\n");
    fs.mkdirSync(path.join(tmp, 'node_modules', '@zhin.js', 'config-yaml'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'node_modules', '@zhin.js', 'config-yaml', 'index.js'), "export * from '@zhin.js/config-yaml';\n");
    const output = run(pkgPath, '10.30.0');
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).devDependencies['@zhin.js/config-yaml']).toBe('^1.1.0');
    expect(output).toContain('@zhin.js/config-yaml: 已并入或停更，不升级');
    expect(registry.calls).not.toContain('@zhin.js/config-yaml@latest');

    const lines: string[] = [];
    expect(reportRetiredPackages(tmp, line => lines.push(line))).toBe(1);
    const report = lines.join('\n');
    expect(report).toContain('package.json 的 devDependencies 依赖 @zhin.js/config-yaml（^1.1.0）：已停更并入 @zhin.js/runtime');
    expect(report).toContain("import { YamlConfigDocument } from '@zhin.js/runtime'");
    expect(report).toContain("src/config.ts:2 '@zhin.js/config-yaml' → '@zhin.js/runtime'");
    expect(report).not.toContain('node_modules');
    // Nothing is rewritten.
    expect(fs.readFileSync(path.join(tmp, 'src', 'config.ts'), 'utf8')).toContain("from '@zhin.js/config-yaml'");
  });

  it('lists an import of the deleted subpath @zhin.js/agent/tools with @zhin.js/tool (#1250)', () => {
    bot();
    fs.mkdirSync(path.join(tmp, 'tools', 'echo'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tools', 'echo', 'index.ts'), "// old: '@zhin.js/agent/tools'\nimport { defineAgentTool } from '@zhin.js/agent/tools';\n");
    const lines: string[] = [];
    expect(reportRetiredPackages(tmp, line => lines.push(line))).toBe(0);
    const report = lines.join('\n');
    expect(report).toContain("tools/echo/index.ts:2 '@zhin.js/agent/tools' → '@zhin.js/tool'：子路径 @zhin.js/agent/tools 已删除：defineAgentTool 改从 @zhin.js/tool 导入");
    expect(report).not.toContain('index.ts:1');
  });

  it('reports retired packages of a workspace member and nothing for a clean project', () => {
    bot({}, "packages:\n  - 'plugins/*'\n");
    const lines: string[] = [];
    expect(reportRetiredPackages(tmp, line => lines.push(line))).toBe(0);
    expect(lines.join('\n')).toContain('没有依赖已并入或停更的 @zhin.js 包');
    fs.mkdirSync(path.join(tmp, 'plugins', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugins', 'foo', 'package.json'), JSON.stringify({ name: 'foo', dependencies: { '@zhin.js/isolate': '^1.0.0' } }));
    lines.length = 0;
    expect(reportRetiredPackages(tmp, line => lines.push(line))).toBe(1);
    expect(lines.join('\n')).toContain('plugins/foo/package.json 的 dependencies 依赖 @zhin.js/isolate（^1.0.0）：已并入 @zhin.js/runtime');
  });
});
