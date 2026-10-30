import { ConversationRuntime } from '../../../core/src/plugin-runtime/im/conversation-runtime.js';
import { createMemoryContextRepository, createUserMessage, EMPTY_TOKEN_USAGE, projectPromptContext, type AssistantMessage } from '@zhin.js/ai';
import type { ConversationRef } from '@zhin.js/im-contract';
import { conversationContextMessage, deliveredMessageContextRef, deliveredReplyContextRef, deliveredTextDigest, deliveredReplyContextRefs, plannedReplyTexts } from '../../src/session/context-provenance.js';
import { stampDeliveredMessageId } from '../../src/session/participant-header-stamp.js';

it('projects canonical outbound receipts once after history reload without consuming concurrent inbound or independent messages', async () => {
  const conversation: ConversationRef = { endpoint: { adapter: 'root/icqq', id: 'bot-a' }, kind: 'group', id: 'room' };
  const runtime = new ConversationRuntime();
  const refs = ['first', 'second'].map(id => ({ conversation, id }));
  for (const [index, ref] of refs.entries()) {
    await runtime.recordOutbound({ conversation, content: `reply part ${index}` } as never, { status: 'sent', message: ref, outboundTextDigest: deliveredTextDigest(`reply part ${index}`) },
      [{ type: 'text', data: { text: `reply part ${index}` } }]);
  }
  await runtime.recordIncoming({ conversation, message: { conversation, id: 'member' }, content: 'concurrent member message' } as never, { id: 'member' });
  await runtime.recordOutbound({ conversation, content: 'independent notification' } as never,
    { status: 'sent', message: { conversation, id: 'notification' } });
  const pending = await runtime.readContext(conversation, 'consumer', 4);
  const context = conversationContextMessage(pending.blocks)!;
  const reply: AssistantMessage = { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'reply parts' }],
    api: 'test', model: 'test', provider: 'test', usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', contextRefs: ['provider-spoof'] };
  const { repository, sessionStore } = createMemoryContextRepository();
  const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'room' });
  const stamped = stampDeliveredMessageId([reply], refs[0]!.id,
    [deliveredReplyContextRef(sessionId, 'turn'), ...refs.map((ref, index) => deliveredMessageContextRef(ref, deliveredTextDigest(`reply part ${index}`)))]);
  expect((stamped[0] as AssistantMessage).contextRefs).not.toContain('provider-spoof');
  await repository.appendMessages(sessionId, [...stamped, context, createUserMessage('current message')]);
  const loaded = await repository.loadContext(sessionId);
  const output = projectPromptContext(loaded.messages);
  const background = JSON.stringify(output[1]?.content);
  expect(background).not.toContain('reply part 0');
  expect(background).not.toContain('reply part 1');
  expect(background).toContain('concurrent member message');
  expect(background).toContain('independent notification');
  // Projection does not change the consumer cursor or the persisted canonical events/history.
  expect(await runtime.readContext(conversation, 'consumer', 4)).toEqual(pending);
  expect(JSON.stringify((await repository.loadContext(sessionId)).messages)).toContain('reply part 0');
  expect(JSON.stringify(projectPromptContext(loaded.messages.slice(1)))).toContain('reply part 0');
  const otherAccount = { ...refs[0]!, conversation: { ...conversation, endpoint: { ...conversation.endpoint, id: 'bot-b' } } };
  expect(deliveredMessageContextRef(otherAccount, deliveredTextDigest('same text'))).not.toBe(deliveredMessageContextRef(refs[0]!, deliveredTextDigest('same text')));
});

it('covers only exact planned plain text, leaving rewritten, reordered and rich reply ledgers unclaimed', () => {
  const conversation: ConversationRef = { endpoint: { adapter: 'root/icqq', id: 'bot' }, kind: 'group', id: 'room' };
  const output = ['first', 'second'].map(text => ({ type: 'message' as const, segments: [{ type: 'text', data: { text } }] }));
  const contexts = ['first', 'second'].map((plannedText, index) => ({ message: { conversation, id: String(index) }, plannedText }));
  const planned = plannedReplyTexts(output);
  const covered = deliveredReplyContextRefs('session', 'turn', planned, { status: 'sent', messageContexts: contexts });
  expect(covered).toContain(deliveredReplyContextRef('session', 'turn'));
  expect(covered).toContain(deliveredMessageContextRef(contexts[0]!.message, deliveredTextDigest('first')));
  const rewritten = deliveredReplyContextRefs('session', 'turn', planned, { status: 'sent', messageContexts: [{ ...contexts[0]!, plannedText: 'changed by a send guard' }] });
  expect(rewritten).toEqual([]);
  expect(deliveredReplyContextRefs('session', 'turn', planned, { status: 'sent', messageContexts: [...contexts].reverse() }))
    .not.toContain(deliveredReplyContextRef('session', 'turn'));
  expect(deliveredReplyContextRefs('session', 'turn', plannedReplyTexts([{ type: 'message', segments: [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.test/image.png' } } }] }]), { status: 'sent', messageContexts: contexts }))
    .toEqual([]);
  output[0]!.segments[0]!.data.text = 'mutated by middleware';
  expect(planned[0]).toBe('first');
});
