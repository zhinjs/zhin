import { describe, it, expect } from 'vitest';
import {
  LogLevel,
  parseLogLevel,
  toLogLevelName,
  toLog4jsLevel,
  isValidLogLevelInput,
  isLogLevel,
  isLogLevelEnabled,
  getLevel,
  setLevel,
} from '../src/index.js';

describe('log-level', () => {
  it('LogLevel 常量为小写字符串', () => {
    expect(LogLevel.DEBUG).toBe('debug');
    expect(LogLevel.INFO).toBe('info');
    expect(LogLevel.SILENT).toBe('silent');
  });

  it('parseLogLevel 支持旧版数字与 log4js 字符串', () => {
    expect(parseLogLevel(0)).toBe('debug');
    expect(parseLogLevel(1)).toBe('info');
    expect(parseLogLevel('INFO')).toBe('info');
    expect(parseLogLevel('off')).toBe('silent');
    expect(parseLogLevel('trace')).toBe('debug');
  });

  it('getLevel / setLevel 底层返回字符串', () => {
    setLevel('warn');
    expect(getLevel()).toBe('warn');
    expect(isLogLevel(getLevel())).toBe(true);
  });

  it('isLogLevelEnabled 按级别过滤', () => {
    expect(isLogLevelEnabled('warn', 'info')).toBe(true);
    expect(isLogLevelEnabled('debug', 'info')).toBe(false);
  });

  it('toLog4jsLevel 与 qq-official-bot 传参一致', () => {
    expect(toLog4jsLevel('info')).toBe('info');
    expect(toLog4jsLevel(LogLevel.SILENT)).toBe('off');
  });

  it('toLogLevelName 规范为小写', () => {
    expect(toLogLevelName(1)).toBe('info');
    expect(toLogLevelName('WARN')).toBe('warn');
  });

  it('isValidLogLevelInput 校验非法值', () => {
    expect(isValidLogLevelInput('info')).toBe(true);
    expect(isValidLogLevelInput(2)).toBe(true);
    expect(isValidLogLevelInput('verbose')).toBe(false);
  });
});
