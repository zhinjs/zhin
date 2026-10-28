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
const transport = {
  complete: vi.fn(),
  completeSimple: completeSimpleMock,
};

import {
  autoCompactAgentMessagesIfNeeded,
  compactAgentMessages,
  createAgentCompactionState,
  shouldAutoCompactAgentMessages,
} from '../../src/compaction/agent-message-compaction.js';
import { MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from '../../src/compaction/compaction.js';
import { createUserMessage, EMPTY_TOKEN_USAGE, type AgentMessage, type AssistantMessage } from '../../src/llm/types/agent-message.js';
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
  return { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] };
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
      transport,
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
      transport,
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
        transport,
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
        transport,
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
      transport,
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
      transport,
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

  it('retains ordered tool calls, exact arguments and their successful or failed outcomes for summarization', async () => {
    completeSimpleMock.mockResolvedValue(assistantOf('检查完成，第二个文件读取失败。'));
    const firstArguments = { path: '/synthetic/a.txt', lines: [1, 5], recursive: false };
    const secondArguments = { path: '/synthetic/b.txt', encoding: null };
    const calls: AssistantMessage = {
      role: 'assistant', timestamp: 2, api: 'mock', provider: 'mock', model: 'mock',
      usage: EMPTY_TOKEN_USAGE, stopReason: 'toolCalls',
      content: [
        { type: 'text', text: '检查两个文件。' },
        { type: 'toolCall', id: 'read-a', name: 'read_file', arguments: firstArguments },
        { type: 'text', text: '接着检查第二个。' },
        { type: 'toolCall', id: 'read-b', name: 'read_file', arguments: secondArguments },
      ],
    };
    const messages: AgentMessage[] = [
      createUserMessage('只批准读取这两个文件，不要修改。', undefined, 1, {
        subjectId: 'owner-id', displayName: 'Owner', roles: ['owner'], scope: 'group',
      }),
      calls,
      { role: 'toolResult', timestamp: 3, toolCallId: 'read-b', toolName: 'read_file', isError: true,
        content: [{ type: 'text', text: 'synthetic permission denied' }] },
      { role: 'toolResult', timestamp: 4, toolCallId: 'read-a', toolName: 'read_file', isError: false,
        content: [{ type: 'text', text: 'synthetic file content' }] },
      createUserMessage('同意修改文件。', undefined, 5, {
        subjectId: 'member-id', displayName: 'Member', roles: ['user'], scope: 'group',
      }),
      createUserMessage('最近消息', undefined, 6),
    ];

    const result = await compactAgentMessages({ transport, model, messages, keepRecentTokens: 1, minKeepCount: 1 });

    const context = completeSimpleMock.mock.calls[0]![1];
    const transcript = context.messages[0].content[0].text;
    const callA = JSON.stringify({ id: 'read-a', name: 'read_file', arguments: firstArguments });
    const callB = JSON.stringify({ id: 'read-b', name: 'read_file', arguments: secondArguments });
    expect(transcript).toContain(callA);
    expect(transcript).toContain(callB);
    expect(transcript.indexOf('检查两个文件。')).toBeLessThan(transcript.indexOf(callA));
    expect(transcript.indexOf(callA)).toBeLessThan(transcript.indexOf('接着检查第二个。'));
    expect(transcript.indexOf('接着检查第二个。')).toBeLessThan(transcript.indexOf(callB));
    expect(transcript).toContain(JSON.stringify({ toolCallId: 'read-b', toolName: 'read_file', isError: true }));
    expect(transcript).toContain(JSON.stringify({ toolCallId: 'read-a', toolName: 'read_file', isError: false }));
    expect(transcript).toContain('synthetic permission denied');
    expect(transcript).toContain('synthetic file content');
    expect(transcript).toContain('[User:Owner id=owner-id roles=owner] 只批准读取这两个文件，不要修改。');
    expect(transcript).toContain('[User:Member id=member-id roles=user] 同意修改文件。');
    expect(result.keptMessages).toEqual([messages.at(-1)]);
    expect(context.tools).toBeUndefined();
  });

  it('retains a tool-only assistant call and invalid input details without replaying private reasoning or signatures', async () => {
    completeSimpleMock.mockResolvedValue(assistantOf('参数无效，读取未完成。'));
    const inputError = { raw: '{"path":', message: 'Unexpected end of JSON input' };
    const messages: AgentMessage[] = [
      createUserMessage('读取测试文件。', undefined, 1),
      {
        role: 'assistant', timestamp: 2, api: 'mock', provider: 'mock', model: 'mock',
        usage: EMPTY_TOKEN_USAGE, stopReason: 'toolCalls',
        content: [
          { type: 'thinking', thinking: 'PRIVATE_REASONING_SENTINEL', providerOptions: { anthropic: { signature: 'THINKING_SIGNATURE_SENTINEL' } } },
          { type: 'toolCall', id: 'invalid-read', name: 'read_file', arguments: {}, inputError,
            providerOptions: { google: { thoughtSignature: 'CALL_SIGNATURE_SENTINEL' } } },
        ],
      },
      { role: 'toolResult', timestamp: 3, toolCallId: 'invalid-read', toolName: 'read_file', isError: true,
        content: [{ type: 'text', text: '参数不是完整 JSON，未执行读取。' }] },
      createUserMessage('最近消息', undefined, 4),
    ];

    await compactAgentMessages({ transport, model, messages, keepRecentTokens: 1, minKeepCount: 1 });

    const context = completeSimpleMock.mock.calls[0]![1];
    const serialized = JSON.stringify(context);
    const transcript = context.messages[0].content[0].text;
    expect(transcript).toContain(JSON.stringify({ id: 'invalid-read', name: 'read_file', arguments: {}, inputError }));
    expect(transcript).toContain(JSON.stringify({ toolCallId: 'invalid-read', toolName: 'read_file', isError: true }));
    expect(serialized).not.toContain('PRIVATE_REASONING_SENTINEL');
    expect(serialized).not.toContain('THINKING_SIGNATURE_SENTINEL');
    expect(serialized).not.toContain('CALL_SIGNATURE_SENTINEL');
  });
});

describe('agent-message-compaction 取消信号（S13）', () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
  });

  it('把 signal 透传给摘要请求', async () => {
    completeSimpleMock.mockResolvedValue(assistantOf('真实摘要'));
    const controller = new AbortController();
    await autoCompactAgentMessagesIfNeeded({
      transport,
      model,
      messages: makeMessages(),
      force: true,
      config: { keepRecentTokens: 5, minKeepCount: 1 },
      signal: controller.signal,
    });
    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(completeSimpleMock.mock.calls[0]![2]).toMatchObject({ signal: controller.signal });
  });

  it('调用方取消不计入熔断失败数', async () => {
    const controller = new AbortController();
    completeSimpleMock.mockImplementation(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    const state = createAgentCompactionState();
    const messages = makeMessages();
    const result = await autoCompactAgentMessagesIfNeeded({
      transport,
      model,
      messages,
      state,
      force: true,
      config: { keepRecentTokens: 5, minKeepCount: 1 },
      signal: controller.signal,
    });
    expect(state.consecutiveFailures).toBe(0);
    expect(result.messages).toEqual(messages);
  });
});

describe('summary acceptance', () => {
  beforeEach(() => completeSimpleMock.mockReset());

  it.each(['length', 'toolCalls', 'error', 'aborted'])('rejects a nonempty %s completion', async (stopReason) => {
    completeSimpleMock.mockResolvedValue({ ...assistantOf('半段摘要'), stopReason });
    const messages = makeMessages();
    const state = createAgentCompactionState();
    const result = await autoCompactAgentMessagesIfNeeded({ transport, model, messages, state, force: true,
      config: { keepRecentTokens: 5, minKeepCount: 1 } });
    expect(result.messages).toEqual(messages);
    expect(result.wasCompacted).toBe(false);
    expect(result.summary).toBeUndefined();
  });

  it('rejects tool calls even with a stop finish and useful text', async () => {
    const response = assistantOf('摘要');
    completeSimpleMock.mockResolvedValue({ ...response, content: [...response.content,
      { type: 'toolCall', name: 'lookup', id: 'c', arguments: {} }] });
    await expect(compactAgentMessages({ transport, model, messages: makeMessages(), keepRecentTokens: 5, minKeepCount: 1 }))
      .rejects.toThrow();
  });

  it('rejects a summary whose wrapped message is no smaller than the replaced history', async () => {
    completeSimpleMock.mockResolvedValue(assistantOf('冗长摘要'.repeat(200)));
    const messages = makeMessages();
    const state = createAgentCompactionState();
    const result = await autoCompactAgentMessagesIfNeeded({ transport, model, messages, state, force: true,
      config: { keepRecentTokens: 5, minKeepCount: 1 } });
    expect(result.messages).toEqual(messages);
    expect(result.wasCompacted).toBe(false);
    expect(result.summary).toBeUndefined();
    expect(state.consecutiveFailures).toBe(1);
  });

  it('does not report success or reset failures when the retention boundary keeps everything', async () => {
    const state = createAgentCompactionState();
    state.consecutiveFailures = 2;
    const messages = makeMessages();
    const result = await autoCompactAgentMessagesIfNeeded({ transport, model, messages, state, force: true });
    expect(completeSimpleMock).not.toHaveBeenCalled();
    expect(result.wasCompacted).toBe(false);
    expect(result.messages).toBe(messages);
    expect(state.consecutiveFailures).toBe(2);
  });

  it('does not accept a completed summary after cancellation', async () => {
    const controller = new AbortController();
    completeSimpleMock.mockImplementation(async () => { controller.abort(); return assistantOf('有效摘要'); });
    const messages = makeMessages();
    const state = createAgentCompactionState();
    const result = await autoCompactAgentMessagesIfNeeded({ transport, model, messages, state, force: true,
      signal: controller.signal, config: { keepRecentTokens: 5, minKeepCount: 1 } });
    expect(result.messages).toEqual(messages);
    expect(result.summary).toBeUndefined();
    expect(state.consecutiveFailures).toBe(0);
  });
});
