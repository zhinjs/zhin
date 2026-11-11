/**
 * Token 估算测试（compaction 共享的 token-counter）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@zhin.js/logger', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    Logger: class {
      debug = vi.fn();
      info = vi.fn();
      warn = vi.fn();
      error = vi.fn();
    },
  };
});

import {
  estimateTokens,
  estimateMessagesTokens,
  estimateTextTokens,
} from '../src/compaction/index.js';
import type { ChatMessage } from '../src/types.js';

const createMsg = (role: 'user' | 'assistant' | 'system', content: string): ChatMessage => ({
  role,
  content,
});

describe('estimateTokens', () => {
  it('should estimate tokens for string content', () => {
    expect(estimateTokens(createMsg('user', 'hello'))).toBeGreaterThanOrEqual(4);
    expect(estimateTokens(createMsg('user', 'a'.repeat(40)))).toBe(14); // 40/4 + 4
  });

  it('should handle non-string content (JSON stringified)', () => {
    const msg: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'hi' }] };
    expect(estimateTokens(msg)).toBeGreaterThanOrEqual(4);
  });

  it('should include reasoning_content length in estimate', () => {
    const a = createMsg('assistant', 'hi');
    const b: ChatMessage = { ...a, reasoning_content: 'x'.repeat(40) };
    expect(estimateTokens(b)).toBeGreaterThan(estimateTokens(a));
  });

  it('should weight CJK chars ~1 token each (不再按 length/4 低估)', () => {
    // 4 个汉字：旧实现 length/4 只估 1 token，现在应约 4 token + 4 固定开销
    expect(estimateTokens(createMsg('user', '你好世界'))).toBe(8);
    expect(estimateTextTokens('你好世界')).toBe(4);
  });

  it('should weight mixed CJK/ASCII text by segment', () => {
    // 'hello'(5 ascii) + '你好'(2 CJK) → ceil(2 + 5/4) = 4
    expect(estimateTextTokens('hello你好')).toBe(4);
    // 纯 ASCII 保持 4 字符 ≈ 1 token
    expect(estimateTextTokens('a'.repeat(40))).toBe(10);
  });
});

describe('estimateMessagesTokens', () => {
  it('should sum tokens for all messages', () => {
    const messages = [
      createMsg('user', 'hi'),
      createMsg('assistant', 'hello'),
    ];
    expect(estimateMessagesTokens(messages)).toBe(
      estimateTokens(messages[0]) + estimateTokens(messages[1]),
    );
  });

  it('should return 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});
