/**
 * #1250: the ICQQ SDK wrote every chat message in full into the log (`recv from: …` at info),
 * multi-line texts became several log lines without a timestamp (forgeable), with log4js colours
 * even off a terminal. The bridge routes the SDK through the Zhin logger.
 */
import { describe, expect, it, vi } from 'vitest';
import { bridgeIcqqSdkLogger, DEFAULT_ICQQ_SDK_LOG_LEVEL } from '../src/sdk-logger.js';
import { resolveIcqqConfig } from '../src/protocol.js';

function target() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('ICQQ SDK logger bridge', () => {
  it('drops the per-message lines at the default level warn', () => {
    const zhin = target();
    const sdk = bridgeIcqqSdkLogger(zhin);
    expect(DEFAULT_ICQQ_SDK_LOG_LEVEL).toBe('warn');
    sdk.info('recv from: [Group: 测试群(123), Member: 张三(456)] 第一行\n第二行');
    sdk.info('succeed to send: [Group(123)] hi');
    sdk.info('Welcome, bot!');
    expect(zhin.debug).not.toHaveBeenCalled();
    expect(zhin.info).not.toHaveBeenCalled();
    sdk.warn('heartbeat timeout');
    sdk.error(new Error('boom'));
    sdk.mark('Package Version: icqq@1.12.3');
    expect(zhin.warn).toHaveBeenCalledWith('heartbeat timeout');
    expect(zhin.error).toHaveBeenCalledWith(expect.stringContaining('Error: boom'));
    expect(zhin.info).toHaveBeenCalledWith('Package Version: icqq@1.12.3');
  });

  it('logs message dumps at debug only, escaped onto one line and capped', () => {
    const zhin = target();
    const sdk = bridgeIcqqSdkLogger(zhin, 'debug');
    sdk.info('recv from: [Group: g(1), Member: m(2)] hi\n[10:00:00.000][ERROR] [gateway] forged\r\nbye');
    expect(zhin.info).not.toHaveBeenCalled();
    expect(zhin.debug).toHaveBeenCalledTimes(1);
    const line = String(zhin.debug.mock.calls[0]![0]);
    expect(line).not.toMatch(/[\r\n]/u);
    expect(line).toContain('hi⏎[10:00:00.000][ERROR] [gateway] forged⏎bye');
    sdk.info(`recv from: [Private: 1(friend)] ${'x'.repeat(5000)}`);
    expect(String(zhin.debug.mock.calls[1]![0]).length).toBeLessThan(400);
  });

  it('escapes ANSI escapes and keeps other SDK lines on one line', () => {
    const zhin = target();
    const sdk = bridgeIcqqSdkLogger(zhin, 'info');
    sdk.info('\u001b[32mcolored\u001b[0m', { a: 1 });
    expect(zhin.info).toHaveBeenCalledWith('\\u001b[32mcolored\\u001b[0m { a: 1 }');
    sdk.error(new Error('multi\nline'));
    expect(String(zhin.error.mock.calls[0]![0])).not.toMatch(/\n/u);
  });

  it('still redacts verification links and phone numbers', () => {
    const zhin = target();
    const sdk = bridgeIcqqSdkLogger(zhin);
    sdk.mark('请访问：https://ssl.captcha.qq.com/x?sid=LEAK 密保手机号：138****0000');
    expect(zhin.info).toHaveBeenCalledWith('请访问：https://ssl.captcha.qq.com/x?… 密保手机号：***');
  });

  it('honours level changes made by the SDK and off', () => {
    const zhin = target();
    const sdk = bridgeIcqqSdkLogger(zhin, 'off');
    sdk.fatal('nothing');
    expect(zhin.error).not.toHaveBeenCalled();
    sdk.level = 'info';
    sdk.info('now visible');
    expect(zhin.info).toHaveBeenCalledWith('now visible');
    sdk.level = 'nonsense';
    expect(sdk.level).toBe('info');
  });
});

describe('logLevel configuration', () => {
  it('defaults to warn and rejects unknown levels', () => {
    expect(resolveIcqqConfig({ id: '10001' }).logLevel).toBe('warn');
    expect(resolveIcqqConfig({ id: '10001', logLevel: 'debug' }).logLevel).toBe('debug');
    expect(() => resolveIcqqConfig({ id: '10001', logLevel: 'verbose' as never })).toThrow(/logLevel/u);
  });
});
