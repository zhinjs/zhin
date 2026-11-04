import { createHash } from 'node:crypto';
import { createUserMessage, EMPTY_TOKEN_USAGE, renderContextMessage, type AgentMessage, type AssistantMessage, type UserMessage } from '../../src/llm/types/agent-message.js';
import { projectPromptContext } from '../../src/memory/prompt-context.js';
import { createMemoryContextRepository } from '../../src/memory/context-repository.js';
import { microCompactAgentMessages } from '../../src/compaction/agent-micro-compact.js';
import { compactAgentMessages, summaryAsAgentUserMessage } from '../../src/compaction/agent-message-compaction.js';
import { agentMessagesToAiSdk } from '../../src/llm/bridge/ai-sdk-messages.js';

const assistant = (references: readonly string[]): AssistantMessage => ({
  role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'Delivered answer' }],
  api: 'test', provider: 'test', model: 'test', usage: EMPTY_TOKEN_USAGE, stopReason: 'stop',
  contextRefs: references,
  contextDigest: createHash('sha256').update(JSON.stringify(['Delivered answer'])).digest('hex'),
} as AssistantMessage);

const background = (): UserMessage => {
  const blocks = [
    { type: 'untrusted_conversation_event' as const, eventType: 'message.created', text: 'own first delivered message', source: 'external_content', reference: 'delivery:one' },
    { type: 'untrusted_conversation_event' as const, eventType: 'message.created', text: 'own second delivered message', source: 'external_content', reference: 'delivery:two' },
    { type: 'untrusted_conversation_event' as const, eventType: 'message.created', text: 'independent notification', source: 'external_content', reference: 'delivery:independent' },
    { type: 'untrusted_conversation_event' as const, eventType: 'message.reaction_changed', text: 'reaction to the first message', source: 'external_content', reference: 'delivery:one' },
    { type: 'untrusted_conversation_event' as const, eventType: 'message.recalled', text: 'a message was recalled', source: 'external_content', reference: 'delivery:one' },
  ];
  return { ...createUserMessage(renderContextMessage({ role: 'user-context', blocks }), undefined, 2), contextBlocks: blocks } as UserMessage;
};

it('deduplicates represented message events after persistence and restores them when their assistant leaves the visible history', async () => {
  const { repository, sessionStore } = createMemoryContextRepository();
  const session = await sessionStore.getOrCreateActive({ session_key: 'represented-context' });
  const raw: AgentMessage[] = [assistant(['delivery:one', 'delivery:two']), background(), createUserMessage('current')];
  await repository.appendMessages(session.session_id, raw);
  const loaded = await repository.loadContext(session.session_id);
  const before = JSON.stringify(loaded.messages);
  const projected = JSON.stringify(projectPromptContext(loaded.messages));
  expect(projected).not.toContain('own first delivered message');
  expect(projected).not.toContain('own second delivered message');
  expect(projected).toContain('independent notification');
  expect(projected).toContain('reaction to the first message');
  expect(projected).toContain('a message was recalled');
  expect(JSON.stringify(loaded.messages)).toBe(before);
  // A tail/branch/compaction view without the original assistant must retain the full event.
  expect(JSON.stringify(projectPromptContext(loaded.messages.slice(1)))).toContain('own first delivered message');
});

it('keeps unknown provenance, same text from another reference, and context modified by a hook', () => {
  const original = background();
  const modified = { ...original, content: [{ type: 'text' as const, text: 'hook changed this context' }] };
  const legacy = createUserMessage(renderContextMessage({ role: 'user-context', blocks: [{ type: 'untrusted_conversation_event', eventType: 'message.created', text: 'own first delivered message' }] }));
  const out = projectPromptContext([assistant(['another-account:delivery:one']), original, modified, legacy]);
  expect(JSON.stringify(out)).toContain('own first delivered message');
  expect(out[2]).toBe(modified);
  expect(out[3]).toBe(legacy);
  const changedReply = { ...assistant(['delivery:one']), content: [{ type: 'text' as const, text: 'hook changed the assistant reply' }] };
  expect(JSON.stringify(projectPromptContext([changedReply, original]))).toContain('own first delivered message');
});

it('omits the standalone background message when every event is represented', () => {
  const original = background();
  const block = (original as UserMessage & { contextBlocks: unknown[] }).contextBlocks[0];
  const contextBlocks = [block] as NonNullable<UserMessage['contextBlocks']>;
  const user = { ...original, contextBlocks, content: [{ type: 'text' as const, text: renderContextMessage({ role: 'user-context', blocks: contextBlocks }) }] };
  expect(projectPromptContext([assistant(['delivery:one']), user])).toEqual([assistant(['delivery:one'])]);
});

it('reprojects full events after L1 and L2 compaction and keeps provenance off provider messages', async () => {
  const sent = assistant(['delivery:one', 'delivery:two']);
  sent.content = [{ type: 'text', text: 'A long delivered explanation. '.repeat(80) }];
  sent.contextDigest = createHash('sha256').update(JSON.stringify(sent.content.filter(block => block.type === 'text').map(block => block.text))).digest('hex');
  const raw = [sent, background()];
  const l1 = microCompactAgentMessages(raw, { force: true, keepRecentToolResults: 0 });
  expect(JSON.stringify(projectPromptContext(l1.messages))).not.toContain('own first delivered message');
  const l2 = await compactAgentMessages({
    transport: { completeSimple: async () => assistant([]) } as never,
    model: { id: 'local-test' } as never, messages: raw, keepRecentTokens: 1, minKeepCount: 1,
  });
  expect(l2.keptMessages).toEqual([raw[1]]);
  const after = projectPromptContext([summaryAsAgentUserMessage(l2.summary), ...l2.keptMessages]);
  expect(JSON.stringify(after)).toContain('own first delivered message');
  const wire = JSON.stringify(agentMessagesToAiSdk(projectPromptContext(raw)));
  expect(wire).not.toContain('contextRefs');
  expect(wire).not.toContain('contextBlocks');
  expect(wire).not.toContain('contextDigest');
  expect(wire).not.toContain('delivery:one');
  expect(wire).not.toContain('own first delivered message');
});

it('uses the active persisted branch and restores full events after a committed compaction checkpoint', async () => {
  const { repository, sessionStore } = createMemoryContextRepository();
  const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'branches' });
  await repository.appendMessages(sessionId, [createUserMessage('branch point', undefined, 1)]);
  const branchPoint = (await repository.loadMessageRows(sessionId))[0]!.id!;
  await repository.appendMessages(sessionId, [assistant(['delivery:one', 'delivery:two']), background(), createUserMessage('next on A')]);
  const branchA = (await repository.loadMessageRows(sessionId)).at(-1)!.id!;
  expect(JSON.stringify(projectPromptContext((await repository.loadContext(sessionId)).messages))).not.toContain('own first delivered message');
  expect(await repository.setActiveLeaf(sessionId, branchPoint)).toBe(true);
  await repository.appendMessages(sessionId, [assistant([]), background(), createUserMessage('next on B')]);
  expect(JSON.stringify(projectPromptContext((await repository.loadContext(sessionId)).messages))).toContain('own first delivered message');
  expect(await repository.setActiveLeaf(sessionId, branchA)).toBe(true);
  const loadedA = await repository.loadContext(sessionId);
  expect(JSON.stringify(projectPromptContext(loadedA.messages))).not.toContain('own first delivered message');
  expect(await repository.saveCompactionSummary(sessionId, 'Earlier answer', loadedA.messages.slice(0, 2))).toBe(true);
  const after = await repository.loadContext(sessionId);
  expect(JSON.stringify(projectPromptContext(after.messages))).toContain('own first delivered message');
  expect(await repository.loadMessageRows(sessionId)).toHaveLength(7);
});
