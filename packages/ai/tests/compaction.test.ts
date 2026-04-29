/**
 * Compaction 测试
 *
 * 测试会话压缩功能：
 * - compactSession: 压缩超过阈值的历史
 * - compactSession: 保留最近消息（含 system）
 * - compactSession: 空历史、低于阈值
 * - Token 估算、分块、剪裁
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  splitMessagesByTokenShare,
  chunkMessagesByMaxTokens,
  computeAdaptiveChunkRatio,
  resolveContextWindowTokens,
  evaluateContextWindowGuard,
  pruneHistoryForContext,
  compactSession,
  DEFAULT_CONTEXT_TOKENS,
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
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

describe('splitMessagesByTokenShare', () => {
  it('should split messages into roughly equal token parts', () => {
    const messages = [
      createMsg('user', 'a'.repeat(100)),
      createMsg('assistant', 'b'.repeat(100)),
      createMsg('user', 'c'.repeat(100)),
      createMsg('assistant', 'd'.repeat(100)),
    ];
    const chunks = splitMessagesByTokenShare(messages, 2);
    expect(chunks.length).toBe(2);
    expect(chunks.flat()).toHaveLength(4);
  });

  it('should return single chunk when parts <= 1', () => {
    const messages = [createMsg('user', 'hi'), createMsg('assistant', 'hello')];
    expect(splitMessagesByTokenShare(messages, 1)).toEqual([messages]);
    expect(splitMessagesByTokenShare(messages, 0)).toEqual([messages]);
  });

  it('should return empty array for empty messages', () => {
    expect(splitMessagesByTokenShare([], 2)).toEqual([]);
  });

  it('should cap parts to message count', () => {
    const messages = [createMsg('user', 'a'), createMsg('assistant', 'b')];
    const chunks = splitMessagesByTokenShare(messages, 10);
    expect(chunks.length).toBeLessThanOrEqual(2);
  });
});

describe('chunkMessagesByMaxTokens', () => {
  it('should chunk when total exceeds maxTokens', () => {
    const messages = [
      createMsg('user', 'x'.repeat(200)),
      createMsg('assistant', 'y'.repeat(200)),
    ];
    const chunks = chunkMessagesByMaxTokens(messages, 50);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty array for empty messages', () => {
    expect(chunkMessagesByMaxTokens([], 100)).toEqual([]);
  });
});

describe('computeAdaptiveChunkRatio', () => {
  it('should return BASE_CHUNK_RATIO for small messages', () => {
    const messages = [createMsg('user', 'hi'), createMsg('assistant', 'hello')];
    const ratio = computeAdaptiveChunkRatio(messages, 128_000);
    expect(ratio).toBeGreaterThanOrEqual(0.15);
    expect(ratio).toBeLessThanOrEqual(0.4);
  });

  it('should return BASE_CHUNK_RATIO for empty messages', () => {
    expect(computeAdaptiveChunkRatio([], 128_000)).toBe(0.4);
  });
});

describe('resolveContextWindowTokens', () => {
  it('should prefer config over model', () => {
    const r = resolveContextWindowTokens(64_000, 128_000);
    expect(r.tokens).toBe(64_000);
    expect(r.source).toBe('config');
  });

  it('should use model when config is absent or invalid', () => {
    const r = resolveContextWindowTokens(undefined, 64_000);
    expect(r.tokens).toBe(64_000);
    expect(r.source).toBe('model');
  });

  it('should fall back to default when both absent', () => {
    const r = resolveContextWindowTokens(undefined, undefined);
    expect(r.tokens).toBe(DEFAULT_CONTEXT_TOKENS);
    expect(r.source).toBe('default');
  });

  it('should floor fractional values', () => {
    expect(resolveContextWindowTokens(64_000.7, undefined).tokens).toBe(64_000);
  });
});

describe('evaluateContextWindowGuard', () => {
  it('should set shouldWarn when below warn threshold', () => {
    const r = evaluateContextWindowGuard({ tokens: 20_000, source: 'config' });
    expect(r.shouldWarn).toBe(true);
    expect(r.shouldBlock).toBe(false);
  });

  it('should set shouldBlock when below hard min', () => {
    const r = evaluateContextWindowGuard({ tokens: 10_000, source: 'config' });
    expect(r.shouldBlock).toBe(true);
  });

  it('should not warn or block when above thresholds', () => {
    const r = evaluateContextWindowGuard({ tokens: 64_000, source: 'config' });
    expect(r.shouldWarn).toBe(false);
    expect(r.shouldBlock).toBe(false);
  });
});

describe('pruneHistoryForContext', () => {
  it('should prune messages when over budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      createMsg(i % 2 === 0 ? 'user' : 'assistant', `msg ${i} `.repeat(50)),
    );
    const result = pruneHistoryForContext({
      messages,
      maxContextTokens: 500,
      maxHistoryShare: 0.5,
    });
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.droppedCount).toBeGreaterThan(0);
    expect(result.droppedTokens).toBeGreaterThan(0);
  });

  it('should not prune when under budget', () => {
    const messages = [createMsg('user', 'hi'), createMsg('assistant', 'hello')];
    const result = pruneHistoryForContext({
      messages,
      maxContextTokens: 100_000,
    });
    expect(result.messages).toEqual(messages);
    expect(result.droppedCount).toBe(0);
  });

  it('should return correct PruneResult shape', () => {
    const messages = [createMsg('user', 'hi')];
    const result = pruneHistoryForContext({ messages, maxContextTokens: 100_000 });
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('droppedMessages');
    expect(result).toHaveProperty('droppedChunks');
    expect(result).toHaveProperty('droppedCount');
    expect(result).toHaveProperty('droppedTokens');
    expect(result).toHaveProperty('keptTokens');
    expect(result).toHaveProperty('budgetTokens');
  });
});

describe('compactSession', () => {
  let mockProvider: { chat: ReturnType<typeof vi.fn>; models: string[] };

  beforeEach(() => {
    mockProvider = {
      models: ['mock-model'],
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { content: '摘要内容' } }],
      }),
    };
  });

  it('should compact messages when over threshold', async () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      createMsg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`),
    );
    const result = await compactSession({
      provider: mockProvider as any,
      messages,
      keepRecentCount: 6,
    });
    expect(result.compactedCount).toBe(6);
    expect(result.keptMessages).toHaveLength(6);
    expect(result.summary).toBe('摘要内容');
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  it('should preserve system messages when in kept range', async () => {
    const messages = [
      createMsg('user', 'old1'),
      createMsg('assistant', 'old2'),
      createMsg('user', 'old3'),
      createMsg('assistant', 'old4'),
      createMsg('system', 'You are helpful'),
      createMsg('user', 'recent1'),
      createMsg('assistant', 'recent2'),
    ];
    const result = await compactSession({
      provider: mockProvider as any,
      messages,
      keepRecentCount: 4,
    });
    expect(result.keptMessages).toContainEqual(
      expect.objectContaining({ role: 'system', content: 'You are helpful' }),
    );
  });

  it('should handle empty history', async () => {
    const result = await compactSession({
      provider: mockProvider as any,
      messages: [],
    });
    expect(result.summary).toBe('');
    expect(result.keptMessages).toEqual([]);
    expect(result.compactedCount).toBe(0);
    expect(result.savedTokens).toBe(0);
  });

  it('should handle history below threshold (no compaction needed)', async () => {
    const messages = [
      createMsg('user', 'hi'),
      createMsg('assistant', 'hello'),
    ];
    const result = await compactSession({
      provider: mockProvider as any,
      messages,
      keepRecentCount: 6,
    });
    expect(result.compactedCount).toBe(0);
    expect(result.keptMessages).toEqual(messages);
    expect(result.summary).toBe('');
    expect(result.savedTokens).toBe(0);
    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  it('should have correct function signature and return type', async () => {
    const result = await compactSession({
      provider: mockProvider as any,
      messages: [createMsg('user', 'hi')],
    });
    expect(typeof result.summary).toBe('string');
    expect(Array.isArray(result.keptMessages)).toBe(true);
    expect(typeof result.compactedCount).toBe('number');
    expect(typeof result.savedTokens).toBe('number');
  });

  it('should use default contextWindow and keepRecentCount when not provided', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMsg('user', `msg ${i}`),
    );
    const result = await compactSession({
      provider: mockProvider as any,
      messages,
    });
    expect(result.keptMessages).toHaveLength(6);
    expect(result.compactedCount).toBe(4);
  });
});
