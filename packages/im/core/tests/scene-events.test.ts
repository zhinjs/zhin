import { describe, expect, it } from 'vitest';
import { MemoryConversationEventStore, type ConversationEvent } from '@zhin.js/im-contract';
import { buildNotice, buildRequest, senderFromId } from '../src/side-event/normalize.js';
import { composeSideEventName, sideEventConversation } from '../src/side-event/base.js';
import { RuntimeNotice, type IncomingNotice } from '../src/notice.js';
import { RuntimeRequest, type IncomingRequest } from '../src/request.js';
import { ConversationRuntime } from '../src/plugin-runtime/im/conversation-runtime.js';
import {
  SCENE_EVENT_SUMMARY_MAX,
  sceneEventPriority,
  summarizeSceneEvent,
} from '../src/side-event/scene-events.js';

// Canonical (already adapter-mapped) events. Raw-protocol → canonical mapping is covered in
// @zhin.js/adapter-onebot-events; core only consumes the canonical shape.
const context = {
  endpoint: Object.freeze({ id: 'bot\u0000bot', adapter: 'test' }),
  generation: 1,
  client: () => undefined,
};
const SELF = new Set(['10000']);

interface NoticeSpec {
  sub: string;
  id: string;
  scene?: string;
  actor?: string;
  target?: string;
  time?: number;
  extra?: Partial<IncomingNotice>;
}

function canonicalNotice(spec: NoticeSpec): IncomingNotice {
  const scene = spec.scene ?? 'group';
  return buildNotice({}, {
    id: spec.id,
    clientAdapter: 'test',
    endpointId: 'bot',
    type: 'notice',
    conversation: sideEventConversation(scene, '1'),
    name: composeSideEventName('notice', scene, spec.sub),
    actor: senderFromId(spec.actor),
    target: senderFromId(spec.target),
    timestamp: (spec.time ?? 1) * 1000,
    ...spec.extra,
  });
}

function canonicalRequest(sub: 'group' | 'friend', id: string, actor: string, comment?: string): IncomingRequest {
  return buildRequest({}, {
    id,
    clientAdapter: 'test',
    endpointId: 'bot',
    type: 'request',
    conversation: sideEventConversation(sub, sub === 'group' ? '1' : actor),
    name: composeSideEventName('request', sub, 'add'),
    actor: senderFromId(actor)!,
    comment,
    timestamp: 8000,
    async $approve() {},
    async $reject() {},
  }) as IncomingRequest;
}

async function storeNotice(spec: NoticeSpec) {
  const runtime = new ConversationRuntime(new MemoryConversationEventStore());
  const notice = new RuntimeNotice(canonicalNotice(spec), context as never);
  return runtime.recordNotice(notice);
}

describe('#996 scene event normalize', () => {
  it('mute of the bot → member.muted (high) with "you" in summary', async () => {
    const stored = await storeNotice({ sub: 'ban', id: 'n1', actor: '2', target: '10000', time: 1_700_000_000, extra: { durationSeconds: 600 } });
    expect(stored?.event.type).toBe('member.muted');
    expect(sceneEventPriority(stored!.event, SELF)).toBe('high');
    expect(summarizeSceneEvent(stored!.event, { selfIds: SELF })).toBe('you muted 10m by 2');
  });

  it('poke: bot target is high, person↔person is low', async () => {
    const atBot = await storeNotice({ sub: 'poke', id: 'n2', actor: '2', target: '10000' });
    expect(atBot?.event.type).toBe('conversation.poked');
    expect(sceneEventPriority(atBot!.event, SELF)).toBe('high');
    const between = await storeNotice({ sub: 'poke', id: 'n3', actor: '2', target: '3', time: 2 });
    expect(sceneEventPriority(between!.event, SELF)).toBe('low');
  });

  it('reaction removed → message.reaction_changed removed, low', async () => {
    const stored = await storeNotice({ sub: 'emoji_reaction', id: 'n4', actor: '2', time: 3, extra: { messageId: 'seq:99', reaction: '76', operation: 'removed' } });
    expect(stored?.event).toMatchObject({ type: 'message.reaction_changed', operation: 'removed', reaction: '76' });
    expect(sceneEventPriority(stored!.event, SELF)).toBe('low');
  });

  it('admin enabled keeps enabled (role_changed)', async () => {
    const stored = await storeNotice({ sub: 'admin_change', id: 'n5', target: '2', time: 4, extra: { role: 'admin', enabled: true } });
    expect(stored?.event).toMatchObject({ type: 'member.role_changed', role: 'admin', enabled: true });
  });

  it('card / title change → card/title changes (low)', async () => {
    const card = await storeNotice({ sub: 'card_change', id: 'n6', actor: '2', target: '2', time: 5, extra: { value: '新名片 第二行' } });
    expect(card?.event).toMatchObject({ type: 'member.card_changed', member: { id: '2' }, value: '新名片 第二行' });
    expect(sceneEventPriority(card!.event, SELF)).toBe('low');
    const title = await storeNotice({ sub: 'title_change', id: 'n7', actor: '2', target: '2', time: 6, extra: { value: '龙王' } });
    expect(title?.event).toMatchObject({ type: 'member.title_changed', value: '龙王' });
  });

  it('group notice update → scene.notice_updated (high), body clipped', async () => {
    const stored = await storeNotice({ sub: 'notice_updated', id: 'n8', actor: '2', time: 7, extra: { value: 'x'.repeat(200) } });
    expect(stored?.event.type).toBe('scene.notice_updated');
    expect((stored!.event as Extract<ConversationEvent, { type: 'scene.notice_updated' }>).text.length).toBeLessThanOrEqual(40);
    expect(sceneEventPriority(stored!.event, SELF)).toBe('high');
  });

  it('join request → scene.join_requested (high); friend request is ignored', async () => {
    const runtime = new ConversationRuntime(new MemoryConversationEventStore());
    const group = new RuntimeRequest(canonicalRequest('group', 'f1', '5', '想进群学习 {"raw":true}'), context as never);
    const stored = await runtime.recordRequest(group);
    expect(stored?.event).toMatchObject({ type: 'scene.join_requested', actor: { id: '5' } });
    expect(sceneEventPriority(stored!.event, SELF)).toBe('high');
    expect(summarizeSceneEvent(stored!.event)).toContain('asks to join');
    const friend = new RuntimeRequest(canonicalRequest('friend', 'f2', '6'), context as never);
    expect(await runtime.recordRequest(friend)).toBeUndefined();
  });

  it('duplicate notices are not re-published', async () => {
    const runtime = new ConversationRuntime(new MemoryConversationEventStore());
    const spec: NoticeSpec = { sub: 'member_increase', id: 'dup', target: '7', time: 10 };
    const first = await runtime.recordNotice(new RuntimeNotice(canonicalNotice(spec), context as never));
    const again = await runtime.recordNotice(new RuntimeNotice(canonicalNotice(spec), context as never));
    expect(first?.event.type).toBe('member.joined');
    expect(again).toBeUndefined();
  });

  it('scene-only types stay out of the legacy conversation context blocks', async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    const card = canonicalNotice({ sub: 'card_change', id: 'c1', actor: '2', target: '2', time: 11, extra: { value: 'n' } });
    const joined = canonicalNotice({ sub: 'member_increase', id: 'j1', target: '3', time: 12 });
    const a = await runtime.recordNotice(new RuntimeNotice(card, context as never));
    const b = await runtime.recordNotice(new RuntimeNotice(joined, context as never));
    const { blocks } = await runtime.readContext(a!.event.conversation, 'test', Math.max(a!.sequence, b!.sequence));
    expect(blocks.map((block) => block.eventType)).toEqual(['member.joined']);
  });

  it('summaries are short and never carry raw JSON', () => {
    const event = {
      eventId: 'e', conversation: { endpoint: context.endpoint, kind: 'group', id: '1' }, timestamp: 0,
      type: 'scene.join_requested', actor: { id: '5', displayName: 'A'.repeat(80) }, comment: '{"a":1,"b":[2,3]}'.repeat(5),
    } as unknown as ConversationEvent;
    const text = summarizeSceneEvent(event);
    expect(text.length).toBeLessThanOrEqual(SCENE_EVENT_SUMMARY_MAX);
    expect(text).not.toContain('\n');
  });
});
