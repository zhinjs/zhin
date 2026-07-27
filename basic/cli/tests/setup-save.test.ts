/**
 * setup 保存逻辑回归测试：
 * - --bootstrap --database 组合下配置有变更时仍落盘（修复 if(!options.bootstrap) 跳过保存）
 * - --bootstrap 单独使用、配置无变更时不创建/改写配置
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';

vi.mock('@zhin.js/scaffold-wizard', async (importOriginal) => {
  const original = await importOriginal<typeof import('@zhin.js/scaffold-wizard')>();
  return {
    ...original,
    configureDatabaseOptions: async () => ({
      dialect: 'sqlite' as const,
      filename: './data/bot.db',
      mode: 'wal',
    }),
  };
});

import { setupCommand } from '../src/commands/setup.js';

let tmp: string;
let prevCwd: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-setup-test-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'demo-bot',
    dependencies: { 'zhin.js': 'latest' },
  }, null, 2));
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('setup 配置落盘', () => {
  it('--bootstrap --database：配置有变更时保存 zhin.config.yml', async () => {
    await setupCommand.parseAsync(['node', 'zhin', '--bootstrap', '--database']);
    const configPath = path.join(tmp, 'zhin.config.yml');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = yaml.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.database).toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
  });

  it('--bootstrap 单独使用：配置无变更时不落盘', async () => {
    await setupCommand.parseAsync(['node', 'zhin', '--bootstrap']);
    expect(fs.existsSync(path.join(tmp, 'zhin.config.yml'))).toBe(false);
    // 引导文件仍正常创建
    expect(fs.existsSync(path.join(tmp, 'SOUL.md'))).toBe(true);
  });
});
