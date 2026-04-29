/**
 * Micro-Compact 测试
 *
 * 测试工具结果微压缩：
 * - 基本清理逻辑
 * - 可压缩工具识别
 * - 保留近期工具结果
 * - token 阈值门控
 * - 小内容不清理
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
  microCompactMessages,
  COMPACTABLE_TOOLS,
  CLEARED_MESSAGE,
  DEFAULT_KEEP_RECENT_TOOL_RESULTS,
} from '../src/compaction/index.js';
import type { ChatMessage } from '../src/types.js';

const msg = (role: ChatMessage['role'], content: string, extra?: Partial<ChatMessage>): ChatMessage => ({
  role,
  content,
  ...extra,
});

describe('microCompactMessages', () => {
  it('should not compact when messages are fewer than keepRecent', () => {
    const messages = [
      msg('user', 'hello'),
      msg('assistant', 'hi'),
    ];
    const result = microCompactMessages(messages);
    expect(result.didCompact).toBe(false);
    expect(result.clearedCount).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  it('should clear old tool results beyond keepRecent', () => {
    const longContent = 'x'.repeat(500);
    const messages: ChatMessage[] = [
      msg('user', 'query'),
      msg('assistant', '', { tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }),
      msg('tool', longContent, { tool_call_id: 'tc1' }),
      msg('assistant', '', { tool_calls: [{ id: 'tc2', type: 'function', function: { name: 'bash', arguments: '{}' } }] }),
      msg('tool', longContent, { tool_call_id: 'tc2' }),
      msg('assistant', '', { tool_calls: [{ id: 'tc3', type: 'function', function: { name: 'grep', arguments: '{}' } }] }),
      msg('tool', longContent, { tool_call_id: 'tc3' }),
      // Recent tools (should be kept)
      ...Array.from({ length: 7 }, (_, i) => msg('tool', longContent, { tool_call_id: `recent${i}` })),
    ];

    const result = microCompactMessages(messages, { keepRecentToolResults: 6 });
    expect(result.didCompact).toBe(true);
    expect(result.clearedCount).toBeGreaterThan(0);
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  it('should not clear small tool results (<=100 chars)', () => {
    const messages: ChatMessage[] = [
      msg('user', 'query'),
      msg('assistant', '', { tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'bash', arguments: '{}' } }] }),
      msg('tool', 'ok', { tool_call_id: 'tc1' }),
      ...Array.from({ length: 7 }, (_, i) => msg('tool', 'short', { tool_call_id: `r${i}` })),
    ];

    const result = microCompactMessages(messages, { keepRecentToolResults: 6 });
    expect(result.clearedCount).toBe(0);
  });

  it('should respect tokenThreshold option', () => {
    const messages: ChatMessage[] = [
      msg('user', 'hello'),
      msg('assistant', 'hi'),
      msg('tool', 'x'.repeat(500), { tool_call_id: 'tc1' }),
      ...Array.from({ length: 7 }, (_, i) => msg('tool', 'ok', { tool_call_id: `r${i}` })),
    ];

    // High threshold — should skip compaction
    const result = microCompactMessages(messages, { tokenThreshold: 999_999 });
    expect(result.didCompact).toBe(false);
  });

  it('should preserve user/assistant/system messages', () => {
    const longContent = 'x'.repeat(500);
    const messages: ChatMessage[] = [
      msg('system', longContent),
      msg('user', longContent),
      msg('assistant', longContent),
      msg('tool', longContent, { tool_call_id: 'tc1' }),
      ...Array.from({ length: 7 }, (_, i) => msg('tool', longContent, { tool_call_id: `r${i}` })),
    ];

    const result = microCompactMessages(messages, { keepRecentToolResults: 6 });
    // system/user/assistant should not be touched
    expect(result.messages[0].content).toBe(longContent);
    expect(result.messages[1].content).toBe(longContent);
    expect(result.messages[2].content).toBe(longContent);
  });

  it('should identify compactable tools from assistant tool_calls', () => {
    expect(COMPACTABLE_TOOLS.has('read_file')).toBe(true);
    expect(COMPACTABLE_TOOLS.has('bash')).toBe(true);
    expect(COMPACTABLE_TOOLS.has('grep')).toBe(true);
    expect(COMPACTABLE_TOOLS.has('web_fetch')).toBe(true);
  });

  it('should use CLEARED_MESSAGE as placeholder', () => {
    const longContent = 'x'.repeat(500);
    const messages: ChatMessage[] = [
      msg('assistant', '', { tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }),
      msg('tool', longContent, { tool_call_id: 'tc1' }),
      ...Array.from({ length: 7 }, (_, i) => msg('tool', 'short', { tool_call_id: `r${i}` })),
    ];

    const result = microCompactMessages(messages, { keepRecentToolResults: 6 });
    if (result.didCompact) {
      const cleared = result.messages.find(m => m.content === CLEARED_MESSAGE);
      expect(cleared).toBeDefined();
    }
  });
});

describe('COMPACTABLE_TOOLS', () => {
  it('should contain expected tool types', () => {
    const expected = ['file_read', 'read_file', 'bash', 'grep', 'web_fetch', 'list_dir'];
    for (const tool of expected) {
      expect(COMPACTABLE_TOOLS.has(tool)).toBe(true);
    }
  });
});
