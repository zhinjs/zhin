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
import { findConfigFile, readConfig, saveConfig } from '../../../packages/host/gateway/src/project/config-file.js';
import { configCommand } from '../src/commands/config.js';
import { createDefaultConfig } from '../src/commands/doctor.js';
import {
  isOldChineseTemplate,
  upgradeBootstrapFiles,
  upgradePackageJson,
  isPinnedSpecifier,
} from '../src/commands/migrate.js';
import { scheduleCommand } from '../src/commands/schedule.js';
import { SOUL_MD_TEMPLATE, TOOLS_MD_TEMPLATE } from '../../../packages/toolkit/create-zhin/src/templates/bootstrap.js';

let tmp: string;
let prevCwd: string;

beforeEach(() => {
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
    expect(pkg.dependencies).toEqual({ 'zhin.js': 'workspace:*', '@zhin.js/agent': 'latest', 'user-library': '^2.0.0' });
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
    expect(output).toContain('@zhin.js/agent: ^1.1.0 → latest');
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
    expect(preview).toContain('@zhin.js/gateway: + dependencies (latest)');
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).devDependencies['@zhin.js/cli']).toBe('^1.1.20');

    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies).toEqual({ 'zhin.js': 'latest', '@zhin.js/cli': 'latest', '@zhin.js/gateway': 'latest' });
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
    expect(preview).toContain('@zhin.js/cli: + dependencies (latest)');
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
    expect(pkg.dependencies).toEqual({ 'zhin.js': 'latest' });
    expect(pkg.devDependencies).toEqual({ '@zhin.js/cli': 'latest' });
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
    expect(pkg.dependencies['zhin.js']).toBe('latest');
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
      expect(output).toContain('zhin.js: ^1.1.0 → latest');
      expect(output).not.toContain('@zhin.js/agent-feature: 1.1.6 → latest');
      expect(output).toContain('@zhin.js/agent-feature: 1.1.6 已锁定');
    } finally { log.mockRestore(); }
    upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).dependencies).toEqual({
      'zhin.js': 'latest',
      '@zhin.js/agent-feature': '1.1.6',
      '@zhin.js/calendar': 'link:../calendar',
      '@zhin.js/local': 'file:./vendor/local.tgz',
    });
  });

  it('isPinnedSpecifier 区分锁定与跟随上游的写法', () => {
    for (const pinned of ['1.1.6', '=1.2.3', 'v1.0.0', '1.2.0-beta.1', 'link:../x', 'file:../x', 'npm:zhin.js@1.0.0', 'github:zhinjs/zhin', 'https://x/y.tgz', './vendor/x.tgz']) {
      expect(isPinnedSpecifier(pinned), pinned).toBe(true);
    }
    for (const floating of ['^1.1.0', '~1.1.0', '>=1.0.0', '*', 'latest', 'next', '1.x']) {
      expect(isPinnedSpecifier(floating), floating).toBe(false);
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
    expect(pkg.scripts).toMatchObject({
      dev: 'zhin start --foreground --watch source config',
      start: 'zhin start --foreground --mode production --no-watch',
      daemon: 'zhin start --mode production --no-watch',
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
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'http:\n  port: 9321\n  token: secret\n');
    stubHost(() => ({ status: 201, body: { success: true, data: { job: { id: 'sched_1' } } } }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

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
    expect(output).toContain(new Date(Date.UTC(2026, 10, 16, 0)).toLocaleString());
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
});
