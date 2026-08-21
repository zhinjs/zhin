/**
 * AgentMessage compaction 失败语义测试
 *
 * 覆盖：
 * - 摘要失败（限流/断网/空结果）时不得注入占位摘要，必须保留原文并计入熔断
 * - 连续失败达到上限后熔断器生效
 * - 成功路径注入真实摘要
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const completeSimpleMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    completeSimple: completeSimpleMock,
  };
});

import {
  autoCompactAgentMessagesIfNeeded,
  compactAgentMessages,
  createAgentCompactionState,
  shouldAutoCompactAgentMessages,
} from '../../src/compaction/agent-message-compaction.js';
import { MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from '../../src/compaction/compaction.js';
import { createUserMessage, type AgentMessage } from '../../src/llm/types/agent-message.js';
import type { Model } from '../../src/llm/types/model.js';

const model = { id: 'mock-model' } as unknown as Model;

function makeMessages(): AgentMessage[] {
  return [
    createUserMessage('第一条历史消息，需要被压缩'),
    createUserMessage('第二条历史消息，也需要被压缩'),
    createUserMessage('最近一条消息，应当保留'),
  ];
}

function assistantOf(text: string) {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

describe('agent-message-compaction 失败语义', () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
  });

  it('摘要调用失败时保留原文、不注入占位摘要、熔断计数 +1', async () => {
    completeSimpleMock.mockRejectedValue(new Error('429 Too Many Requests'));
    const state = createAgentCompactionState();
    const messages = makeMessages();

    const result = await autoCompactAgentMessagesIfNeeded({
      model,
      messages,
      state,
      force: true,
      config: { keepRecentTokens: 5, minKeepCount: 1 },
    });

    expect(state.consecutiveFailures).toBe(1);
    expect(result.summary).toBeUndefined();
    expect(result.messages).toEqual(messages);
    const injected = result.messages[0];
    expect(JSON.stringify(injected)).not.toContain('无历史记录');
    expect(JSON.stringify(injected)).not.toContain('[Previous conversation summary]');
  });

  it('摘要返回空文本视为失败，同样保留原文并计数', async () => {
    completeSimpleMock.mockResolvedValue(assistantOf('   '));
    const state = createAgentCompactionState();
    const messages = makeMessages();

    const result = await autoCompactAgentMessagesIfNeeded({
      model,
      messages,
      state,
      force: true,
      config: { keepRecentTokens: 5, minKeepCount: 1 },
    });

    expect(state.consecutiveFailures).toBe(1);
    expect(result.summary).toBeUndefined();
    expect(result.messages).toEqual(messages);
  });

  it('连续失败达到上限后熔断器生效，不再尝试 auto-compact', async () => {
    completeSimpleMock.mockRejectedValue(new Error('network down'));
    const state = createAgentCompactionState();

    for (let i = 0; i < MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES; i++) {
      await autoCompactAgentMessagesIfNeeded({
        model,
        messages: makeMessages(),
        state,
        force: true,
        config: { keepRecentTokens: 5, minKeepCount: 1 },
      });
    }
    expect(state.consecutiveFailures).toBe(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES);
    expect(shouldAutoCompactAgentMessages(makeMessages(), 100, state)).toBe(false);
  });

  it('compactAgentMessages 在摘要失败时抛错（由上层决定保留原文）', async () => {
    completeSimpleMock.mockRejectedValue(new Error('boom'));
    await expect(
      compactAgentMessages({
        model,
        messages: makeMessages(),
        keepRecentTokens: 5,
        minKeepCount: 1,
      }),
    ).rejects.toThrow('boom');
  });

  it('成功路径注入真实摘要并重置熔断计数', async () => {
    completeSimpleMock.mockResolvedValue(assistantOf('这是真实摘要'));
    const state = createAgentCompactionState();
    state.consecutiveFailures = 2;

    const result = await autoCompactAgentMessagesIfNeeded({
      model,
      messages: makeMessages(),
      state,
      force: true,
      config: { keepRecentTokens: 5, minKeepCount: 1 },
    });

    expect(result.wasCompacted).toBe(true);
    expect(result.summary).toBe('这是真实摘要');
    expect(state.consecutiveFailures).toBe(0);
    expect(JSON.stringify(result.messages[0])).toContain('[Previous conversation summary]');
    expect(result.messages.length).toBe(2); // 摘要 + 保留的最近一条
  });

  it('多人会话 transcript 明确标注参与者并要求保留归属与分歧', async () => {
    completeSimpleMock.mockResolvedValue(assistantOf('Alice 与 Bob 对迁移方案存在分歧。'));
    const messages: AgentMessage[] = [
      createUserMessage('先不要改数据库', undefined, 1, {
        subjectId: 'alice-id', displayName: 'Alice', roles: ['owner'], scope: 'group',
      }),
      createUserMessage('可以直接迁移 schema', undefined, 2, {
        subjectId: 'bob-id', displayName: 'Bob', roles: ['user'], scope: 'group',
      }),
      createUserMessage('先评估兼容性', undefined, 3, {
        subjectId: 'alice-id', displayName: 'Alice', roles: ['owner'], scope: 'group',
      }),
      createUserMessage('最近消息', undefined, 4, {
        subjectId: 'bob-id', displayName: 'Bob', roles: ['user'], scope: 'group',
      }),
    ];

    await compactAgentMessages({
      model,
      messages,
      keepRecentTokens: 2,
      minKeepCount: 1,
    });

    const context = completeSimpleMock.mock.calls[0]?.[1];
    const serialized = JSON.stringify(context);
    expect(serialized).toContain('[User:Alice id=alice-id roles=owner] 先不要改数据库');
    expect(serialized).toContain('[User:Bob id=bob-id roles=user] 可以直接迁移 schema');
    expect(serialized.toLowerCase()).toContain('conflicting opinions');
    expect(serialized).toContain('authority-sensitive');
  });
});
