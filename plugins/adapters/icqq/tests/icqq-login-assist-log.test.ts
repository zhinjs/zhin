import { describe, expect, it, vi } from 'vitest';
import { LoginAssist } from '@zhin.js/core';
import { icqqLinkHost, runIcqqLoginAssistStep } from '../src/icqq-login-assist.js';

describe('icqq login assist logs', () => {
  it('logs the challenge kind and the link host, never the link (it carries a sid)', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const lines: string[] = [];
    const logger = { info: vi.fn((line: string) => lines.push(line)), warn: vi.fn((line: string) => lines.push(line)), debug: vi.fn(), error: vi.fn() };
    const controller = new AbortController();
    const step = runIcqqLoginAssistStep({
      assist, client: {} as never, adapter: 'icqq', endpointKey: '10001', owner: {}, logger: logger as never,
      step: 'slider', event: { url: 'https://t.captcha.qq.com/x?sid=SECRETSID123' }, signal: controller.signal,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort(new Error('test done'));
    await step.catch(() => undefined);
    assist.dispose();
    expect(lines.join('\n')).toContain('t.captcha.qq.com');
    expect(lines.join('\n')).toContain('slider');
    expect(lines.join('\n')).not.toContain('SECRETSID');
  });

  it('reduces links to their http(s) host', () => {
    expect(icqqLinkHost('https://accounts.qq.com/safe/verify?sid=x')).toBe('accounts.qq.com');
    expect(icqqLinkHost('javascript:alert(1)')).toBeUndefined();
    expect(icqqLinkHost('not a url')).toBeUndefined();
    expect(icqqLinkHost(undefined)).toBeUndefined();
  });
});
