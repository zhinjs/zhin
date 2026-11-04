import { describe, expect, it } from 'vitest';
import { createUserMessage, EMPTY_TOKEN_USAGE, projectPromptContext, type AssistantMessage, type UserMessage } from '@zhin.js/ai';
import {
  stampAssistantHeaders,
  stampDeliveredMessageId,
  stampUserHeader,
} from '../../src/session/participant-header-stamp.js';
import { resolveTurnQuote, summarizeQuotedMessage } from '../../src/session/turn-quote.js';
import { createConversationReferenceCapability } from '../../src/tool/conversation-reference-tool.js';
import type { TurnIngress } from '../../src/turn/turn-ingress.js';

const reply = (content: AssistantMessage['content'], extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant', content, api: 'a', provider: 'p', model: 'm', usage: EMPTY_TOKEN_USAGE, stopReason: 'stop', timestamp: 1, ...extra,
});

describe('participant facts (ADR 0041 amended: actor-only)', () => {
  it('never writes the rendered header into name; the actor is the stored fact', () => {
    const user = { ...createUserMessage('hi', undefined, 1, { subjectId: '10002', displayName: '小明', roles: ['scene_admin'], scope: 'group' }), messageId: 'native-1' };
    const stamped = stampUserHeader(user);
    expect(stamped).toBe(user);
    expect(stamped.name).toBeUndefined();
    const [rendered] = projectPromptContext([stamped], { timeZone: 'UTC' }) as UserMessage[];
    expect(rendered!.content[0]).toMatchObject({ text: expect.stringMatching(/^\[id:m1;user_id:10002;name:小明;role:admin;date:[\d-]+;time:\d{2}:\d{2};\]\nhi$/u) });
    const anonymous = createUserMessage('synthetic');
    expect(stampUserHeader(anonymous)).toBe(anonymous);
  });

  it('stamps only assistant messages with text, with the turn bot as assistantActor, never overwriting', () => {
    const bot = { id: '20001', name: 'Zhin', platformRole: 'admin' };
    const text = reply([{ type: 'text', text: 'hi' }]);
    const calls = reply([{ type: 'toolCall', id: 'c', name: 't', arguments: {} }]);
    const named = reply([{ type: 'text', text: 'x' }], { name: '[user_id:other;]' });
    const [a, b, c] = stampAssistantHeaders([text, calls, named], bot) as AssistantMessage[];
    expect(a!.assistantActor).toEqual({ subjectId: '20001', displayName: 'Zhin', roles: ['admin'] });
    expect(a!.name).toBeUndefined();
    expect(b).toBe(calls);
    expect(c).toBe(named);
    const noBot = [text];
    expect(stampAssistantHeaders(noBot, undefined)).toBe(noBot);
  });

  it('records the delivered platform id on the last text-bearing assistant message', () => {
    const first = reply([{ type: 'text', text: 'working' }]);
    const calls = reply([{ type: 'toolCall', id: 'c', name: 't', arguments: {} }]);
    const final = reply([{ type: 'text', text: 'done' }]);
    const out = stampDeliveredMessageId([first, calls, final], 'native-bot-1') as AssistantMessage[];
    expect(out[2]!.messageId).toBe('native-bot-1');
    expect(out[0]!.messageId).toBeUndefined();
    expect(final.messageId).toBeUndefined();
    const same = [first];
    expect(stampDeliveredMessageId(same, undefined)).toBe(same);
  });

  it('stamps host delivery references only on the final reply and removes provider-supplied claims', () => {
    const first = reply([{ type: 'text', text: 'working' }], { contextRefs: ['forged'] });
    const final = reply([{ type: 'text', text: 'done' }], { contextRefs: ['also-forged'] });
    const stamped = stampDeliveredMessageId([first, final], 'native', ['host-reference']) as AssistantMessage[];
    expect(stamped[0]!.contextRefs).toBeUndefined();
    expect(stamped[1]!.contextRefs).toEqual(['host-reference']);
    expect(first.contextRefs).toEqual(['forged']);
    expect((stampDeliveredMessageId([final], undefined)[0] as AssistantMessage).contextRefs).toBeUndefined();
  });

  it('persists ordered host receipt ids on the final reply and never trusts provider-supplied message lists', () => {
    const first = reply([{ type: 'text', text: 'working' }], { messageIds: ['forged-first'] });
    const final = reply([{ type: 'text', text: 'done' }], { messageIds: ['forged-final'] });
    const stamped = stampDeliveredMessageId([first, final], 'sent-first', undefined,
      ['sent-first', '', 'sent-second']) as AssistantMessage[];
    expect(stamped[0]!.messageIds).toBeUndefined();
    expect(stamped[1]!.messageId).toBe('sent-first');
    expect(stamped[1]!.messageIds).toEqual(['sent-first', null, 'sent-second']);
    expect((stampDeliveredMessageId([final], undefined)[0] as AssistantMessage).messageIds).toBeUndefined();
    expect(final.messageIds).toEqual(['forged-final']);
  });
});

describe('quoted message resolution (ADR 0043 §4)', () => {
  const message = (segments: unknown[], extra: Record<string, unknown> = {}) => ({
    ref: { id: 'q' }, actor: { id: '10009', displayName: '阿明' }, segments, timestamp: Date.UTC(2026, 9, 28, 21, 5), ...extra,
  });

  it('summarizes text, mentions and media placeholders into one clipped line', () => {
    const quote = summarizeQuotedMessage('q', message([
      { type: 'mention', data: { target: '1', name: '小红' } },
      { type: 'text', data: { text: ' 看这个\n图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'x' } } },
      { type: 'audio', data: { media: { kind: 'url', value: 'y' }, duration: 3 } },
    ]));
    expect(quote).toMatchObject({ id: 'q', senderId: '10009', text: '@小红 看这个 图 [图片] [语音 3s]' });
    expect(quote.truncated).toBeUndefined();
  });

  it('clips at 120 chars and flags the loss; a forward expands one level and flags nested content', () => {
    const long = summarizeQuotedMessage('q', message([{ type: 'text', data: { text: '长'.repeat(200) } }]));
    expect(Array.from(long.text!)).toHaveLength(120);
    expect(long.truncated).toBe(true);
    const forward = summarizeQuotedMessage('q', message([{ type: 'forward', data: { forward_id: 'f', title: '聊天记录', entries: [
      { actor: { id: '1', displayName: 'A' }, segments: [{ type: 'text', data: { text: '早' } }] },
      { actor: { id: '2', displayName: 'B' }, segments: [{ type: 'forward', data: { forward_id: 'g' } }] },
    ] } }]));
    expect(forward.text).toBe('[转发 聊天记录] A: 早 | B: [转发]');
    expect(forward.truncated).toBe(true);
  });

  const turnWith = (resolve: () => Promise<unknown>, withPort = true): TurnIngress => ({
    input: { text: 'x', references: [{ key: 'ref-1', kind: 'message', sourceId: 'native-q' }] },
    ports: withPort ? { references: { resolve } } : {},
    signal: new AbortController().signal,
  } as unknown as TurnIngress);

  it('keeps just the id when the content cannot be resolved', async () => {
    expect(await resolveTurnQuote(turnWith(async () => ({ status: 'not_found', code: 'x' })))).toEqual({ id: 'native-q' });
    expect(await resolveTurnQuote(turnWith(async () => { throw new Error('boom'); }))).toEqual({ id: 'native-q' });
    expect(await resolveTurnQuote(turnWith(async () => ({}), false))).toEqual({ id: 'native-q' });
    expect(await resolveTurnQuote({ input: { text: 'x' }, ports: {}, signal: new AbortController().signal } as unknown as TurnIngress)).toBeUndefined();
  });

  it('resolves the quoted message through the trusted reference port', async () => {
    const quote = await resolveTurnQuote(turnWith(async () => ({ status: 'resolved', content: message([{ type: 'text', data: { text: '明天开会' } }]) })));
    expect(quote).toMatchObject({ id: 'native-q', senderId: '10009', text: '明天开会' });
  });
});

describe('inspect_conversation_reference accepts the quoted message id (alias already resolved)', () => {
  it('maps a platform id to the turn reference key and still rejects unknown ones', async () => {
    const calls: string[] = [];
    const request = {
      input: { references: [{ key: 'ref-1', kind: 'message', sourceId: 'native-q' }] },
      ports: { references: { resolve: async (key: string) => { calls.push(key); return { status: 'resolved', content: 'ok' }; } } },
      signal: new AbortController().signal,
    } as never;
    const tool = createConversationReferenceCapability({} as never, request)!;
    await tool.execute({ reference: 'native-q' });
    await tool.execute({ reference: 'ref-1' });
    expect(calls).toEqual(['ref-1', 'ref-1']);
    expect(await tool.execute({ reference: 'm9' })).toMatchObject({ status: 'forbidden' });
  });
});
