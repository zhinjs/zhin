import { describe, expect, it } from 'vitest';
import { formatEnvValue, generateDatabaseEnvVars, mergeEnvText } from '../src/env.js';

describe('formatEnvValue', () => {
  it('keeps simple values unquoted', () => {
    expect(formatEnvValue('sk-abc123')).toBe('sk-abc123');
    expect(formatEnvValue(3306)).toBe('3306');
    expect(formatEnvValue('mongodb://localhost:27017')).toBe('mongodb://localhost:27017');
  });

  it('quotes and escapes values with #, spaces, quotes, backslashes or newlines', () => {
    expect(formatEnvValue('p#ss')).toBe('"p#ss"');
    expect(formatEnvValue('has space')).toBe('"has space"');
    expect(formatEnvValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(formatEnvValue('C:\\data\\db')).toBe('"C:\\\\data\\\\db"');
    expect(formatEnvValue('line1\nline2')).toBe('"line1\\nline2"');
  });

  it('quotes empty values', () => {
    expect(formatEnvValue('')).toBe('""');
    expect(formatEnvValue(undefined)).toBe('""');
  });
});

describe('mergeEnvText', () => {
  it('overrides existing keys in place instead of appending duplicates', () => {
    const existing = '# HTTP 服务配置\nHTTP_TOKEN=old-token\n';
    const extra = '\n# 适配器配置\nTELEGRAM_TOKEN=tok-1\n';
    const merged = mergeEnvText(existing, extra);
    expect(merged).toContain('HTTP_TOKEN=old-token');
    expect(merged).toContain('TELEGRAM_TOKEN=tok-1');

    // 第二次运行同 KEY 覆盖：值更新且不产生重复行
    const again = mergeEnvText(merged, '\n# 适配器配置\nTELEGRAM_TOKEN=tok-2\n');
    expect(again).toContain('TELEGRAM_TOKEN=tok-2');
    expect(again).not.toContain('tok-1');
    expect(again.split('TELEGRAM_TOKEN=')).toHaveLength(2);
  });

  it('is idempotent when re-run with identical input', () => {
    const existing = '# HTTP 服务配置\nHTTP_TOKEN=old-token\n';
    const extra = '\n# AI 配置\nAI_API_KEY=sk-1\n';
    const once = mergeEnvText(existing, extra);
    expect(mergeEnvText(once, extra)).toBe(once);
  });

  it('appends section comments only for new keys', () => {
    const merged = mergeEnvText('', '\n# MySQL 数据库配置\nDB_HOST=localhost\nDB_PORT=3306\n');
    expect(merged).toContain('# MySQL 数据库配置');
    expect(merged).toContain('DB_HOST=localhost');
  });
});

describe('generateDatabaseEnvVars', () => {
  it('escapes connection values containing special characters', () => {
    const envVars = generateDatabaseEnvVars({
      dialect: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'p#ss word',
      database: 'test_db',
    });
    expect(envVars).toContain('DB_HOST=localhost');
    expect(envVars).toContain('DB_PASSWORD="p#ss word"');
  });

  it('returns empty string for sqlite', () => {
    expect(generateDatabaseEnvVars({ dialect: 'sqlite', filename: './data/bot.db' })).toBe('');
  });
});
