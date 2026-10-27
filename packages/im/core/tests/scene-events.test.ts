import { describe, expect, it } from 'vitest';
import { MemoryConversationEventStore, type ConversationEvent } from '@zhin.js/im-contract';
import { receiveOneBotLikeSideEvent } from '../src/side-event/dispatch.js';
import { RuntimeNotice, type IncomingNotice } from '../src/notice.js';
import { RuntimeRequest, type IncomingRequest } from '../src/request.js';
import { ConversationRuntime } from '../src/plugin-runtime/im/conversation-runtime.js';
import {
  SCENE_EVENT_SUMMARY_MAX,
  sceneEventPriority,
  summarizeSceneEvent,
} from '../src/side-event/scene-events.js';

const context = {
  endpoint: Object.freeze({ id: 'icqq\u0000bot', adapter: 'icqq' }),
  generation: 1,
  client: () => undefined,
};
const SELF = new Set(['10000']);

async function capture(raw: Record<string, unknown>, platform = 'icqq') {
  const emitted: unknown[] = [];
  await receiveOneBotLikeSideEvent(async (_name, payload) => { emitted.push(payload); }, {
    adapter: 'icqq',
    endpointKey: '10000',
    platform,
    raw,
  });
  return emitted[0];
}

async function storeNotice(raw: Record<string, unknown>, platform = 'icqq') {
  const runtime = new ConversationRuntime(new MemoryConversationEventStore());
  const notice = new RuntimeNotice(await capture(raw, platform) as IncomingNotice, context as never);
  return runtime.recordNotice(notice);
}

describe('#996 scene event normalize', () => {
  it('icqq mute of the bot → member.muted (high) with "you" in summary', async () => {
    const stored = await storeNotice({
      post_type: 'notice', notice_type: 'group', sub_type: 'ban', group_id: 1, operator_id: 2, user_id: 10000, duration: 600, time: 1_700_000_000, self_id: 10000,
    });
    expect(stored?.event.type).toBe('member.muted');
    expect(sceneEventPriority(stored!.event, SELF)).toBe('high');
    expect(summarizeSceneEvent(stored!.event, { selfIds: SELF })).toBe('you muted 10m by 2');
  });

  it('icqq poke: bot target is high, person↔person is low', async () => {
    const atBot = await storeNotice({ post_type: 'notice', notice_type: 'group', sub_type: 'poke', group_id: 1, operator_id: 2, target_id: 10000, user_id: 10000, time: 1 });
    expect(atBot?.event.type).toBe('conversation.poked');
    expect(sceneEventPriority(atBot!.event, SELF)).toBe('high');
    const between = await storeNotice({ post_type: 'notice', notice_type: 'group', sub_type: 'poke', group_id: 1, operator_id: 2, target_id: 3, user_id: 3, time: 2 });
    expect(sceneEventPriority(between!.event, SELF)).toBe('low');
  });

  it('icqq reaction (seq + set=false) → message.reaction_changed removed, low', async () => {
    const stored = await storeNotice({ post_type: 'notice', notice_type: 'group', sub_type: 'reaction', group_id: 1, user_id: 2, id: '76', seq: 99, set: false, time: 3 });
    expect(stored?.event).toMatchObject({ type: 'message.reaction_changed', operation: 'removed', reaction: '76' });
    expect(sceneEventPriority(stored!.event, SELF)).toBe('low');
  });

  it('icqq admin set=true keeps enabled (role_changed)', async () => {
    const stored = await storeNotice({ post_type: 'notice', notice_type: 'group', sub_type: 'admin', group_id: 1, user_id: 2, set: true, time: 4 });
    expect(stored?.event).toMatchObject({ type: 'member.role_changed', role: 'admin', enabled: true });
  });

  it('OneBot group_card / notify title → card/title changes (low), values truncated', async () => {
    const card = await storeNotice({ post_type: 'notice', notice_type: 'group_card', group_id: 1, user_id: 2, card_new: '新名片\n第二行', time: 5 }, 'onebot');
    expect(card?.event).toMatchObject({ type: 'member.card_changed', member: { id: '2' }, value: '新名片 第二行' });
    expect(sceneEventPriority(card!.event, SELF)).toBe('low');
    const title = await storeNotice({ post_type: 'notice', notice_type: 'notify', sub_type: 'title', group_id: 1, user_id: 2, title: '龙王', time: 6 }, 'onebot');
    expect(title?.event).toMatchObject({ type: 'member.title_changed', value: '龙王' });
  });

  it('group notice update → scene.notice_updated (high), body clipped', async () => {
    const stored = await storeNotice({ post_type: 'notice', notice_type: 'group_notice', group_id: 1, operator_id: 2, content: 'x'.repeat(200), time: 7 }, 'onebot');
    expect(stored?.event.type).toBe('scene.notice_updated');
    expect((stored!.event as Extract<ConversationEvent, { type: 'scene.notice_updated' }>).text.length).toBeLessThanOrEqual(40);
    expect(sceneEventPriority(stored!.event, SELF)).toBe('high');
  });

  it('join request → scene.join_requested (high); friend request is ignored', async () => {
    const runtime = new ConversationRuntime(new MemoryConversationEventStore());
    const request = (raw: Record<string, unknown>) => capture(raw) as Promise<IncomingRequest>;
    const group = new RuntimeRequest(await request({ post_type: 'request', request_type: 'group', sub_type: 'add', group_id: 1, user_id: 5, comment: '想进群学习 {"raw":true}', flag: 'f1', time: 8 }), context as never);
    const stored = await runtime.recordRequest(group);
    expect(stored?.event).toMatchObject({ type: 'scene.join_requested', actor: { id: '5' } });
    expect(sceneEventPriority(stored!.event, SELF)).toBe('high');
    expect(summarizeSceneEvent(stored!.event)).toContain('asks to join');
    const friend = new RuntimeRequest(await request({ post_type: 'request', request_type: 'friend', user_id: 6, flag: 'f2', time: 9 }), context as never);
    expect(await runtime.recordRequest(friend)).toBeUndefined();
  });

  it('duplicate notices are not re-published', async () => {
    const runtime = new ConversationRuntime(new MemoryConversationEventStore());
    const raw = { post_type: 'notice', notice_type: 'group', sub_type: 'increase', group_id: 1, user_id: 7, time: 10 };
    const first = await runtime.recordNotice(new RuntimeNotice(await capture(raw) as IncomingNotice, context as never));
    const again = await runtime.recordNotice(new RuntimeNotice(await capture(raw) as IncomingNotice, context as never));
    expect(first?.event.type).toBe('member.joined');
    expect(again).toBeUndefined();
  });

  it('scene-only types stay out of the legacy conversation context blocks', async () => {
    const store = new MemoryConversationEventStore();
    const runtime = new ConversationRuntime(store);
    const card = await capture({ post_type: 'notice', notice_type: 'group_card', group_id: 1, user_id: 2, card_new: 'n', time: 11 }, 'onebot');
    const joined = await capture({ post_type: 'notice', notice_type: 'group', sub_type: 'increase', group_id: 1, user_id: 3, time: 12 });
    const a = await runtime.recordNotice(new RuntimeNotice(card as IncomingNotice, context as never));
    const b = await runtime.recordNotice(new RuntimeNotice(joined as IncomingNotice, context as never));
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
