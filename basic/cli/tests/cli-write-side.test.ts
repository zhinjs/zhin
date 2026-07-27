/**
 * CLI 写侧 legacy 残留修复回归测试：
 * - config-file utils：toml 读写、不支持格式直接报错
 * - config 命令：toml 配置 set 真正落盘
 * - doctor createDefaultConfig：新 Plugin Runtime map 形态
 * - migrate：engines.node、中文模板多命中判定、覆盖前 .bak 备份
 * - schedule add：--prompt option + --at/--every 可用、非法输入统一报错
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { diagnoseConsoleConfig } from '@zhin.js/scaffold-wizard';
import { findConfigFile, readConfig, saveConfig } from '../src/utils/config-file.js';
import { configCommand } from '../src/commands/config.js';
import { createDefaultConfig } from '../src/commands/doctor.js';
import {
  isOldChineseTemplate,
  upgradeBootstrapFiles,
  upgradePackageJson,
} from '../src/commands/migrate.js';
import { scheduleCommand } from '../src/commands/schedule.js';

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
  it('toml 配置可读写往返', async () => {
    const file = path.join(tmp, 'zhin.config.toml');
    await saveConfig(file, { log_level: 'info', ai: { enabled: false } });
    const config = await readConfig(file);
    expect(config).toEqual({ log_level: 'info', ai: { enabled: false } });
  });

  it('findConfigFile 能发现 toml 配置', () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.toml'), 'log_level = "info"\n');
    expect(findConfigFile(tmp)).toBe('zhin.config.toml');
  });

  it('readConfig 对 .ts 配置直接报错而非静默返回 {}', async () => {
    const file = path.join(tmp, 'zhin.config.ts');
    fs.writeFileSync(file, 'export default {};\n');
    await expect(readConfig(file)).rejects.toThrow(/zhin.config.ts/);
  });

  it('saveConfig 对 .ts 配置直接报错', async () => {
    await expect(saveConfig(path.join(tmp, 'zhin.config.ts'), {})).rejects.toThrow();
  });
});

describe('config 命令（toml 落盘）', () => {
  it('config set 真正写入 zhin.config.toml', async () => {
    fs.writeFileSync(
      path.join(tmp, 'zhin.config.toml'),
      'log_level = "info"\n\n[ai]\nenabled = false\n',
    );
    await configCommand.parseAsync(['node', 'zhin', 'set', 'ai.enabled', 'true']);
    const config = await readConfig(path.join(tmp, 'zhin.config.toml'));
    expect((config.ai as Record<string, unknown>).enabled).toBe(true);
    expect(config.log_level).toBe('info');
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
    expect(config.plugins).toEqual({ sandbox: {} });
    const diagnosis = diagnoseConsoleConfig(config);
    expect(diagnosis).toEqual({
      missingHostPlugins: [],
      missingSandboxPlugin: false,
      missingConsoleOrigin: false,
      missingHttpToken: false,
    });
  });
});

describe('migrate', () => {
  it('engines.node 写 ^20.19.0 || >=22.12.0', () => {
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'demo',
      dependencies: { 'zhin.js': '1.0.0' },
    }, null, 2));
    const changed = upgradePackageJson(pkgPath, { toLatest: true, dryRun: false });
    expect(changed).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.engines.node).toBe('^20.19.0 || >=22.12.0');
    expect(pkg.dependencies['zhin.js']).toBe('latest');
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
    expect(next).toContain('Action-oriented');
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

describe('schedule add', () => {
  function readJobs(): any[] {
    const file = path.join(tmp, 'data', 'schedule-jobs.json');
    return JSON.parse(fs.readFileSync(file, 'utf-8')).jobs;
  }

  it('--every + --prompt 可正常添加（不再报 missing prompt）', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '30m', '--prompt', '检查待办']);
    const jobs = readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toEqual({ kind: 'every', everyMs: 30 * 60 * 1000 });
    expect(jobs[0].action.prompt).toBe('检查待办');
  });

  it('--at + --prompt 可正常添加', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '--at', '2099-12-31T09:00:00Z', '--prompt', '年终提醒']);
    const jobs = readJobs();
    expect(jobs[0].schedule.kind).toBe('at');
    expect(jobs[0].action.prompt).toBe('年终提醒');
  });

  it('cron 位置参数 + --prompt 仍可添加', async () => {
    await scheduleCommand.parseAsync(['node', 'zhin', 'add', '0 0 9 * * *', '--prompt', '早报']);
    const jobs = readJobs();
    expect(jobs[0].schedule).toEqual({ kind: 'solar', cron: '0 0 9 * * *' });
  });

  it('非法 --every 统一走 logger.error + exit(1)，而非未捕获异常', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    await expect(
      scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', 'xyz', '--prompt', 'hi']),
    ).rejects.toThrow('process.exit:1');
    expect(fs.existsSync(path.join(tmp, 'data', 'schedule-jobs.json'))).toBe(false);
  });

  it('缺少 --prompt 时报错退出', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    await expect(
      scheduleCommand.parseAsync(['node', 'zhin', 'add', '--every', '30m']),
    ).rejects.toThrow('process.exit:1');
  });
});
