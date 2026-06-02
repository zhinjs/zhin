import { describe, it, expect } from 'vitest';
import {
  isPolicyDenialMessage,
  isPolicyDenialToolResult,
  DEFAULT_POLICY_DENIAL_STOP_AFTER,
} from '../src/agent/policy-denial.js';

describe('policy-denial', () => {
  it('识别 exec 策略拒绝文案', () => {
    expect(isPolicyDenialMessage('命令「sqlite3」不在允许列表中，已被拒绝。')).toBe(true);
    expect(isPolicyDenialMessage('当前配置禁止执行 Shell 命令（execSecurity=deny）')).toBe(true);
  });

  it('识别 ZHIN_NEEDS_OWNER', () => {
    expect(isPolicyDenialMessage('ZHIN_NEEDS_OWNER:\n需要 Owner')).toBe(true);
  });

  it('普通错误不算策略拒绝', () => {
    expect(isPolicyDenialMessage('ENOENT: no such file')).toBe(false);
    expect(isPolicyDenialMessage('工具执行超时')).toBe(false);
  });

  it('JSON 包装的策略错误', () => {
    const json = JSON.stringify({
      error: '命令「rm」不在允许列表中',
      policyBlocked: true,
    });
    expect(isPolicyDenialToolResult(json)).toBe(true);
  });

  it('默认熔断阈值为 2', () => {
    expect(DEFAULT_POLICY_DENIAL_STOP_AFTER).toBe(2);
  });
});
