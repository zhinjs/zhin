import { createMemoryContextRepository, createUserMessage, EMPTY_TOKEN_USAGE, type AgentMessage, type AssistantMessage, type Model } from '@zhin.js/ai';
import { AgentCompactionRuntime } from '../../src/memory/compaction-runtime.js';

const model = { id: 'm', sdk: 'openai' } as Model;
function answer(text: string, stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], stopReason,
    api: 'test', provider: 'test', model: 'm', usage: EMPTY_TOKEN_USAGE, timestamp: 10 };
}
async function fixture() {
  const { repository, sessionStore } = createMemoryContextRepository();
  const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'test' });
  const messages = [createUserMessage('旧记录'.repeat(1200), undefined, 1), answer('已记录'), createUserMessage('最近记录'.repeat(1000), undefined, 11)];
  await repository.appendMessages(sessionId, messages);
  return { repository, sessionId, messages: (await repository.loadContext(sessionId)).messages, runtime: new AgentCompactionRuntime() };
}

describe('compaction persistence boundary', () => {
  it('uses the same effective retention budget for projection and persisted anchor', async () => {
    const { repository, sessionId, messages, runtime } = await fixture();
    const transport = { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('旧记录摘要')) };
    const result = await runtime.transformContext(messages, undefined, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
    });
    expect(transport.completeSimple).toHaveBeenCalledOnce();
    const loaded = await repository.loadContext(sessionId);
    expect(loaded.messages.map(m => m.content)).toEqual(result.map(m => m.content));
    expect(await repository.loadMessageRows(sessionId)).toHaveLength(3);
  });

  it.each(['length', 'error', 'toolCalls', 'aborted'] as const)('never persists a nonempty %s summary', async (reason) => {
    const { repository, sessionId, messages, runtime } = await fixture();
    const save = vi.spyOn(repository, 'saveCompactionSummary');
    const transport = { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('半段摘要', reason)) };
    const result = await runtime.transformContext(messages, undefined, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
    });
    expect(transport.completeSimple).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(result).toBe(messages);
    expect((await repository.loadContext(sessionId)).messages.map(m => m.content)).toEqual(messages.map(m => m.content));
  });

  it('persists the actual prefix when the current turn has not been appended yet', async () => {
    const { repository, sessionStore } = createMemoryContextRepository();
    const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'inflight' });
    await repository.appendMessages(sessionId, [createUserMessage('旧'.repeat(6000)), answer('甲'.repeat(100)), createUserMessage('近'.repeat(2000)), answer('乙'.repeat(1000))]);
    const loaded = await repository.loadContext(sessionId);
    const incoming = createUserMessage('新'.repeat(4000));
    const transport = { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('旧历史摘要')) };
    const result = await new AgentCompactionRuntime().transformContext([...loaded.messages, incoming], undefined, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
    });
    await repository.appendMessages(sessionId, [incoming]);
    expect((await repository.loadContext(sessionId)).messages.map(m => m.content)).toEqual(result.map(m => m.content));
    expect(await repository.loadMessageRows(sessionId)).toHaveLength(5);
  });

  it('preserves provenance when micro-compaction replaces old tool results', async () => {
    const { repository, sessionStore } = createMemoryContextRepository();
    const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'micro' });
    const raw: AgentMessage[] = [createUserMessage('旧问题'.repeat(1200))];
    for (let i = 0; i < 7; i += 1) {
      raw.push({ ...answer(''), content: [{ type: 'toolCall', id: `call-${i}`, name: 'read_file', arguments: { path: 'file.txt' } }] });
      raw.push({ role: 'toolResult', toolCallId: `call-${i}`, toolName: 'read_file', isError: false, timestamp: i + 20,
        content: [{ type: 'text', text: '文件内容'.repeat(600) }] });
    }
    await repository.appendMessages(sessionId, raw);
    const loaded = (await repository.loadContext(sessionId)).messages;
    const incoming = createUserMessage('当前问题');
    const transport = { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('工具调用摘要')) };
    const result = await new AgentCompactionRuntime().transformContext([...loaded, incoming], undefined, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
    });
    expect(transport.completeSimple).toHaveBeenCalledOnce();
    await repository.appendMessages(sessionId, [incoming]);
    expect((await repository.loadContext(sessionId)).messages.map(m => m.content)).toEqual(result.map(m => m.content));
    expect(await repository.loadMessageRows(sessionId)).toHaveLength(raw.length + 1);
  });

  it('does not use an unverified anchor for a custom repository without checkpoint support', async () => {
    const { repository, sessionId, messages, runtime } = await fixture();
    const save = vi.spyOn(repository, 'saveSummary');
    const resolve = vi.spyOn(repository, 'resolveCompactionAnchorId');
    Object.defineProperty(repository, 'saveCompactionSummary', { value: undefined });
    const transport = { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('本回合摘要')) };
    const result = await runtime.transformContext(messages, undefined, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
    });
    expect(result).not.toBe(messages);
    expect(save).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect((await repository.loadContext(sessionId)).messages.map(m => m.content)).toEqual(messages.map(m => m.content));
  });

  it('does not persist cancellation while waiting for the existing write lock', async () => {
    const { repository, sessionId, messages, runtime } = await fixture();
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const lock = Reflect.get(repository, 'writeLock');
    const pending = lock.run(sessionId, () => release.promise);
    const original = repository.saveCompactionSummary.bind(repository);
    vi.spyOn(repository, 'saveCompactionSummary').mockImplementation((...args) => {
      entered.resolve();
      return original(...args);
    });
    const transport = { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('有效摘要')) };
    const running = runtime.transformContext(messages, controller.signal, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
    });
    await entered.promise;
    controller.abort();
    release.resolve();
    await pending;
    expect(await running).toBe(messages);
    expect((await repository.loadContext(sessionId)).messages.map(m => m.content)).toEqual(messages.map(m => m.content));
  });
});
