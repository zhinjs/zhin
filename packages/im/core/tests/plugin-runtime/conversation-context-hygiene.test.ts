import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  MemoryConversationEventStore,
  type ConversationEvent,
  type ConversationRef,
} from '@zhin.js/im-contract';
import {
  CONVERSATION_CONTEXT_MAX_AGE_MS,
  ConversationRuntime,
} from '../../src/plugin-runtime/im/conversation-runtime.js';

const conversation = {
  endpoint: { id: 'bot-1', adapter: 'memory' },
  kind: 'private',
  id: 'user-1',
} as unknown as ConversationRef;

function message(id: string, text: string, timestamp: number, actorId?: string): ConversationEvent {
  return {
    eventId: `message:${id}`,
    conversation,
    timestamp,
    type: 'message.created',
    message: {
      ref: { conversation, id },
      ...(actorId ? { actor: { id: actorId, displayName: 'User' } } : {}),
      segments: [{ type: 'text', data: { text } }],
      timestamp,
    },
  } as ConversationEvent;
}

function recall(id: string, timestamp: number, actorId: string): ConversationEvent {
  return {
    eventId: `notice:recall:${id}`,
    conversation,
    timestamp,
    type: 'message.recalled',
    message: { conversation, id },
    actor: { id: actorId },
  } as ConversationEvent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConversationRuntime context hygiene', () => {
  it('drops the bot recalling its own outbound activity indicator', async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    const now = Date.now();
    await store.append(message('indicator-1', '正在处理中...', now));
    await store.append(recall('indicator-1', now, 'bot-1'));
    await store.append(message('user-old', '在吗', now, 'user-1'));
    await store.append(recall('user-old', now, 'user-1'));
    const current = await store.append(message('current', 'hi', now, 'user-1'));

    const context = await runtime.readContext(conversation, 'agent', current.sequence, 50, 'current');

    expect(context.blocks.map((block) => block.text)).toEqual([
      'User (user-1) [message_id="user-old"]: 在吗',
      'user-1 (user-1) recalled message user-old.',
    ]);
    expect(context.cursor).toBe(current.sequence);
  });

  it('ages out stale backlog messages while still advancing the cursor', async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    const now = Date.now();
    await store.append(message('stale', '#赞我', now - CONVERSATION_CONTEXT_MAX_AGE_MS - 1_000, 'user-1'));
    await store.append(message('recent', '刚才那个', now - 60_000, 'user-1'));
    const current = await store.append(message('current', 'hi', now, 'user-1'));

    const context = await runtime.readContext(conversation, 'agent', current.sequence, 50, 'current');

    expect(context.blocks.map((block) => block.text)).toEqual(['User (user-1) [message_id="recent"]: 刚才那个']);
    expect(context.cursor).toBe(current.sequence);
  });

  it('keeps an approval prompt and its interaction answer out of background events', async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    const now = Date.now();
    await store.append(message('prompt', '操作确认 回复 y / 同意 允许一次', now));
    runtime.markInteractionAnswer({ conversation, id: 'prompt' } as never);
    await store.append(message('answer', 'y', now, 'user-1'));
    runtime.markInteractionAnswer({ conversation, id: 'answer' } as never);
    await store.append(message('later', '顺便看下 README', now, 'user-1'));
    const current = await store.append(message('current', 'hi', now, 'user-1'));

    const context = await runtime.readContext(conversation, 'agent', current.sequence, 50, 'current');

    expect(context.blocks.map((block) => block.text)).toEqual(['User (user-1) [message_id="later"]: 顺便看下 README']);
  });

  it("labels the bot's own messages so the model can tell them from members'", async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    const now = Date.now();
    await store.append(message('q', '谁会配代理', now, 'user-1'));
    await runtime.recordOutbound(
      { conversation, content: [{ type: 'text', data: { text: '我会，发我报错' } }] } as never,
      { status: 'sent', message: { conversation, id: 'bot-1' } } as never,
    );
    await runtime.recordIncoming(
      { conversation, content: '匿名消息', message: { conversation, id: 'anon' } } as never,
      undefined,
    );
    const current = await store.append(message('current', '好', now, 'user-1'));
    const context = await runtime.readContext(conversation, 'agent', current.sequence, 50, 'current');
    expect(context.blocks.map((block) => block.text)).toEqual([
      'User (user-1) [message_id="q"]: 谁会配代理',
      'You (this bot) [message_id="bot-1"]: 我会，发我报错',
      'Unknown sender (unknown) [message_id="anon"]: 匿名消息',
    ]);
  });

  it('drops an own message the bot later recalled, such as an activity indicator', async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    await runtime.recordOutbound(
      { conversation, content: [{ type: 'text', data: { text: '思考中...' } }] } as never,
      { status: 'sent', message: { conversation, id: 'thinking' } } as never,
    );
    await store.append({ eventId: 'recall:thinking', conversation, timestamp: Date.now(), type: 'message.recalled', message: { conversation, id: 'thinking' } } as never);
    const current = await store.append(message('current', 'hi', Date.now(), 'user-1'));
    const context = await runtime.readContext(conversation, 'agent', current.sequence, 50, 'current');
    expect(JSON.stringify(context.blocks)).not.toContain('思考中');
  });

  it('keeps own outbound progress updates out of background events', async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    const now = Date.now();
    await runtime.recordOutbound(
      { conversation, content: [{ type: 'text', data: { text: '⏳ 已经完成一部分，接下来继续。' } }] } as never,
      { status: 'sent', message: { conversation, id: 'progress-1' } } as never,
    );
    const current = await store.append(message('current', '好的', now, 'user-1'));
    const context = await runtime.readContext(conversation, 'agent', current.sequence, 50, 'current');
    expect(JSON.stringify(context.blocks)).not.toContain('已经完成一部分');
  });
});

