import { describe, expect, it } from 'vitest';
import { describeProviderFailure } from '@zhin.js/ai';
import { chatFailureKindOf, chatFailureLine } from '../../src/outbound/chat-failure.js';

describe('chatFailureLine', () => {
  it('says a transient failure like a member and varies the line', () => {
    const lines = new Set([0, 0.4, 0.9].map(random => chatFailureLine('rate_limit', { random })));
    expect(lines.size).toBeGreaterThan(1);
    for (const line of lines) expect(line).not.toMatch(/模型|API|重试|失败/);
  });

  it('appends the cause only for the owner', () => {
    expect(chatFailureLine('quota_exhausted', { random: 0 })).toBe('今天先歇会儿，晚点再找我');
    expect(chatFailureLine('quota_exhausted', { random: 0, master: true })).toBe('今天先歇会儿，晚点再找我（模型额度用完了）');
    expect(chatFailureLine('turn_error', { random: 0, master: true, detail: `boom ${'x'.repeat(80)}` })).toMatch(/（boom x+…）$/);
    expect(chatFailureLine('turn_error', { random: 0, detail: 'boom' })).not.toContain('boom');
  });

  it('refuses a safety block and stays quiet on a cancelled request', () => {
    expect(chatFailureLine('safety_block')).toBe('这个我不接');
    expect(chatFailureLine('safety_block', { master: true })).toBe('这个我不接（内容被模型拦截）');
    expect(chatFailureLine('aborted')).toBe('');
  });
});

describe('chatFailureKindOf', () => {
  it('recovers the kind of a provider or finish failure message', () => {
    expect(chatFailureKindOf(describeProviderFailure('auth'))).toBe('auth');
    expect(chatFailureKindOf(describeProviderFailure('safety_block'))).toBe('safety_block');
    expect(chatFailureKindOf('socket hang up')).toBe('unknown');
    expect(chatFailureKindOf(undefined)).toBe('unknown');
  });
});
