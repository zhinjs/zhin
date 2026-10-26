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
import * as wizard from '@zhin.js/scaffold-wizard';

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

  it('updates an existing editable configuration and retains unrelated values and comments', async () => {
    const file = path.join(tmp, 'zhin.config.yml');
    fs.writeFileSync(file, '# existing\nconfigVersion: 2\nplugins:\n  "10": ten\n  "2": two\n"10":\n  token: "${TOKEN}" # keep\n"2": {}\n');
    await setupCommand.parseAsync(['node', 'zhin', '--database']);
    const source = fs.readFileSync(file, 'utf8');
    expect(yaml.parse(source).database).toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
    expect(source).toContain('# existing');
    expect(source).toContain('"${TOKEN}" # keep');
    expect(source.indexOf('"10": ten')).toBeLessThan(source.indexOf('"2": two'));
  });

  it('rejects a source edit during prompts before writing env or dependencies', async () => {
    const file = path.join(tmp, 'zhin.config.yml');
    fs.writeFileSync(file, 'configVersion: 2\nplugins: {}\nhttp:\n  port: 8080\n');
    const external = '# edited during wizard\nconfigVersion: 2\nplugins: {}\nhttp:\n  port: 9000\n';
    const packageBefore = fs.readFileSync(path.join(tmp, 'package.json'), 'utf8');
    vi.spyOn(wizard, 'configureDatabaseOptions').mockImplementation(async () => {
      fs.writeFileSync(file, external);
      return { dialect: 'sqlite', filename: './data/bot.db' };
    });
    const appendEnv = vi.spyOn(wizard, 'appendWizardEnvVars');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('setup refused'); });
    await expect(setupCommand.parseAsync(['node', 'zhin', '--database'])).rejects.toThrow('setup refused');
    expect(appendEnv).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe(external);
    expect(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')).toBe(packageBefore);
  });

  it('rejects a reserved alias before writing adapter env or package dependencies', async () => {
    const file = path.join(tmp, 'zhin.config.yml');
    const source = 'configVersion: 2\nplugins: {}\n';
    fs.writeFileSync(file, source);
    const packageBefore = fs.readFileSync(path.join(tmp, 'package.json'), 'utf8');
    vi.spyOn(wizard, 'configureAdapters').mockResolvedValue({
      packages: ['@zhin.js/adapter-sandbox'], plugins: ['sandbox'], envVars: { TOKEN: 'dummy' },
      instances: [{ package: '@zhin.js/adapter-sandbox', instanceKey: 'database', config: {} }],
    });
    const appendEnv = vi.spyOn(wizard, 'appendWizardEnvVars');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('setup refused'); });
    await expect(setupCommand.parseAsync(['node', 'zhin', '--adapters'])).rejects.toThrow('setup refused');
    expect(appendEnv).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe(source);
    expect(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')).toBe(packageBefore);
  });
  it('uses the existing project language for prompts and bootstrap files without changing language or timezone', async () => {
    const file = path.join(tmp, 'zhin.config.yml');
    fs.writeFileSync(file, 'configVersion: 2\nlocale: en\nplugins: {}\n');
    const database = vi.spyOn(wizard, 'configureDatabaseOptions');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await setupCommand.parseAsync(['node', 'zhin', '--database', '--bootstrap']);
    expect(database).toHaveBeenCalledWith('en');
    expect(yaml.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ locale: 'en' });
    expect(yaml.parse(fs.readFileSync(file, 'utf8'))).not.toHaveProperty('timezone');
    expect(fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf8')).not.toMatch(/[\u3400-\u9fff]/u);
    expect(log.mock.calls.flat().join(' ')).toContain('Zhin configuration wizard');
  });

  it('persists an explicitly selected language without guessing a timezone', async () => {
    const file = path.join(tmp, 'zhin.config.yml');
    fs.writeFileSync(file, 'configVersion: 2\nlocale: zh-CN\nplugins: {}\n');
    await setupCommand.parseAsync(['node', 'zhin', '--database', '--locale', 'en']);
    const config = yaml.parse(fs.readFileSync(file, 'utf8'));
    expect(config.locale).toBe('en');
    expect(config).not.toHaveProperty('timezone');
  });

});
