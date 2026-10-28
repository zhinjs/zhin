import { autoCompactAgentMessagesIfNeeded, estimateAgentMessagesTokens, createPromptContextBlock, projectPromptContext, createMemoryContextRepository, createUserMessage, renderUserMessageForLlm, EMPTY_TOKEN_USAGE, type AgentMessage, type AssistantMessage, type Model } from '@zhin.js/ai';
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
  it('carries tool outcomes and participant decisions through summary admission, persistence and continuation', async () => {
    const { repository, sessionStore } = createMemoryContextRepository();
    const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'action-checkpoint' });
    const owner = { subjectId: 'owner-id', displayName: 'Owner', roles: ['owner'], scope: 'group' as const };
    const member = { subjectId: 'member-id', displayName: 'Member', roles: ['user'], scope: 'group' as const };
    const toolArguments = { path: '/synthetic/diagnostic.txt' };
    const raw: AgentMessage[] = [
      createUserMessage(`只批准读取，不要修改。${'诊断背景。'.repeat(300)}`, undefined, 1, owner),
      createUserMessage('直接修改文件即可。', undefined, 2, member),
      { ...answer(''), timestamp: 3, stopReason: 'toolCalls', content: [
        { type: 'toolCall', id: 'read-diagnostic', name: 'read_file', arguments: toolArguments },
      ] },
      { role: 'toolResult', timestamp: 4, toolCallId: 'read-diagnostic', toolName: 'read_file', isError: true,
        content: [{ type: 'text', text: 'synthetic permission denied' }] },
      createUserMessage('撤销读取许可，先查权限，不要重试或修改。', undefined, 5, owner),
    ];
    await repository.appendMessages(sessionId, raw);
    const rawBefore = structuredClone(await repository.loadMessageRows(sessionId));
    const loaded = await repository.loadContext(sessionId);
    const current = createUserMessage('继续排查权限，仍然不要修改。', undefined, 11, owner);
    // The synthetic checkpoint checks pipeline fidelity, not a real model's recall quality.
    const checkpoint = 'read-diagnostic: read_file /synthetic/diagnostic.txt failed. Owner revoked read permission; '
      + 'do not retry or modify. Member suggested modification without owner approval. Next: inspect permissions.';
    const transport = { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer(checkpoint)) };
    const runtime = new AgentCompactionRuntime();
    const compacted = await runtime.transformContext([...loaded.messages, current], undefined, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
      compactionConfig: { keepRecentTokens: 1, minKeepCount: 1 }, force: true,
    });

    expect(transport.completeSimple).toHaveBeenCalledOnce();
    const transcript = transport.completeSimple.mock.calls[0]![1].messages[0].content[0].text;
    expect(transcript).toContain(JSON.stringify({ id: 'read-diagnostic', name: 'read_file', arguments: toolArguments }));
    expect(transcript).toContain(JSON.stringify({ toolCallId: 'read-diagnostic', toolName: 'read_file', isError: true }));
    expect(transcript).toContain('synthetic permission denied');
    expect(transcript).toContain('[User:Owner id=owner-id roles=owner] 撤销读取许可，先查权限，不要重试或修改。');
    expect(transcript).toContain('[User:Member id=member-id roles=user] 直接修改文件即可。');
    expect(compacted).toHaveLength(2);
    expect(JSON.stringify(compacted[0].content)).toContain(checkpoint);
    expect(compacted[1]).toBe(current);

    await repository.appendMessages(sessionId, [current]);
    runtime.clear();
    const reloaded = await repository.loadContext(sessionId);
    const continued = await new AgentCompactionRuntime().transformContext(reloaded.messages, undefined, {
      host: { contextRepository: repository }, sessionId, model, transport, contextWindow: 8192, reservedTokens: 1000,
    });
    expect(continued.map(message => message.content)).toEqual([compacted[0].content, renderUserMessageForLlm(current).content]);
    expect(continued[1]).toMatchObject({ role: 'user', actor: owner, content: renderUserMessageForLlm(current).content });
    expect(transport.completeSimple).toHaveBeenCalledOnce();
    const rawAfter = await repository.loadMessageRows(sessionId);
    expect(rawAfter.slice(0, rawBefore.length)).toEqual(rawBefore);
    expect(rawAfter).toHaveLength(raw.length + 1);
  });

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

it('restores a full marked context after compaction and reload without changing raw records', async () => {
  const { repository, sessionStore } = createMemoryContextRepository();
  const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'marked' });
  const marked = () => ({ ...createUserMessage(''), content: [
    { type: 'text' as const, text: 'Recent work remains verbatim. '.repeat(20) }, createPromptContextBlock('workspace', 'Stable rules: verify sources.'),
  ] });
  const raw = [marked(), createUserMessage('older task details '.repeat(2000)), marked()];
  await repository.appendMessages(sessionId, raw);
  const loaded = (await repository.loadContext(sessionId)).messages;
  const result = await new AgentCompactionRuntime().transformContext(loaded, undefined, {
    host: { contextRepository: repository }, sessionId, model,
    transport: { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('Older task was discussed.')) },
    contextWindow: 8192, reservedTokens: 1000, compactionConfig: { keepRecentTokens: 100, minKeepCount: 1 },
  });
  const reloaded = (await repository.loadContext(sessionId)).messages;
  expect(projectPromptContext(reloaded).map(message => message.content)).toEqual(projectPromptContext(result).map(message => message.content));
  expect(JSON.stringify(projectPromptContext(reloaded))).toContain('Stable rules: verify sources.');
  expect(await repository.loadMessageRows(sessionId)).toHaveLength(raw.length);
  expect(reloaded.length).toBeLessThan(raw.length);
});

it('rejects a checkpoint when restoring a full context erases the projected savings', async () => {
  const { repository, sessionStore } = createMemoryContextRepository();
  const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'no-savings' });
  const marked = () => ({ ...createUserMessage(''), content: [
    { type: 'text' as const, text: 'turn' }, createPromptContextBlock('workspace', 'Stable rules: verify sources.'),
  ] });
  const raw = [marked(), createUserMessage('older task details '.repeat(2000)), marked()];
  await repository.appendMessages(sessionId, raw);
  const loaded = (await repository.loadContext(sessionId)).messages;
  const save = vi.spyOn(repository, 'saveCompactionSummary');
  const summarize = vi.fn().mockResolvedValue(answer('Older task was discussed.'));
  const result = await new AgentCompactionRuntime().transformContext(loaded, undefined, {
    host: { contextRepository: repository }, sessionId, model,
    transport: { complete: vi.fn(), completeSimple: summarize },
    contextWindow: 8192, reservedTokens: 1000, compactionConfig: { keepRecentTokens: 100, minKeepCount: 1 },
  });
  expect(summarize).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(result).toBe(loaded);
  expect((await repository.loadContext(sessionId)).messages.map(message => message.content)).toEqual(loaded.map(message => message.content));
});

it('reports summary savings after restoring the retained full context', async () => {
  const marked = () => ({ ...createUserMessage(''), content: [
    { type: 'text' as const, text: 'Recent work remains verbatim. '.repeat(20) },
    createPromptContextBlock('workspace', 'Stable rules: verify sources. '.repeat(100)),
  ] });
  const raw = [marked(), createUserMessage('older task details '.repeat(2000)), marked()];
  const result = await autoCompactAgentMessagesIfNeeded({
    messages: raw, model, transport: { complete: vi.fn(), completeSimple: vi.fn().mockResolvedValue(answer('Older task was discussed.')) },
    config: { contextWindow: 100_000, keepRecentTokens: 100, minKeepCount: 1 }, force: true,
  });
  expect(result.wasCompacted).toBe(true);
  const savings = estimateAgentMessagesTokens(projectPromptContext(raw)) - estimateAgentMessagesTokens(projectPromptContext(result.messages));
  expect(result.savedTokens).toBe(savings);
  expect(result.autoSavedTokens).toBe(savings);
});
