import { getAdapterLogger } from '@zhin.js/logger';
import type { IncomingNotice } from '@zhin.js/core';
import { receiveKookSideEvent } from '../src/side-event-dispatch.js';
import type { KookWebhookEventData } from '../src/protocol.js';

function receive(event: KookWebhookEventData): IncomingNotice {
  const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
  expect(receiveKookSideEvent(emit, 'bot', event, getAdapterLogger('kook', 'test'))).toBe(true);
  return emit.mock.calls[0]![1] as IncomingNotice;
}

describe('KOOK notice conversation projection', () => {
  // https://developer.kookapp.cn/doc/event/channel
  it('uses extra.body channel and actor with the system target as guild parent', () => {
    const notice = receive({ type: 255, channel_type: 'GROUP', target_id: 'guild', author_id: '1',
      extra: { type: 'deleted_reaction', body: { channel_id: 'channel', user_id: 'user', msg_id: 'message', emoji: { id: 'emoji' } } } });
    expect(notice).toMatchObject({ name: 'notice.channel.emoji_reaction',
      conversation: { kind: 'channel', id: 'channel', parent: { kind: 'channel', id: 'guild' } },
      actor: { id: 'user' }, messageId: 'message', reaction: 'emoji', operation: 'removed' });
  });

  it('preserves deletion event ids without claiming the message author performed the deletion', () => {
    const raw: KookWebhookEventData = { type: 255, channel_type: 'GROUP', target_id: 'guild', author_id: '1',
      msg_timestamp: 1700000000000, extra: { type: 'deleted_message', body: { channel_id: 'channel', msg_id: 'message', author_id: 'original-author' } } };
    const first = receive({ ...raw, msg_id: 'event-1' });
    const second = receive({ ...raw, msg_id: 'event-2' });
    expect(first.id).toBe('event-1');
    expect(second.id).toBe('event-2');
    expect(first.actor).toBeUndefined();
    expect(first.metadata).toMatchObject({ extra: { body: { author_id: 'original-author' } } });
    const fallback1 = receive(raw);
    const fallback2 = receive({ ...raw, extra: { ...raw.extra, body: { ...raw.extra?.body, msg_id: 'another-message' } } });
    expect(fallback1.id).not.toBe(fallback2.id);
  });

  it.each(['joined_guild', 'exited_guild'])('keeps %s as membership data without a send target', (type) => {
    const notice = receive({ type: 255, channel_type: 'GROUP', target_id: 'guild', author_id: '1',
      extra: { type, body: { user_id: 'member' } } });
    expect(notice.conversation).toBeUndefined();
    expect(notice.actor).toBeUndefined();
    expect(notice.target).toEqual({ id: 'member', name: 'member' });
  });

  it('does not replace a missing channel id with the actor, guild or bot', () => {
    const notice = receive({ type: 255, channel_type: 'GROUP', target_id: 'guild', author_id: '1',
      extra: { type: 'added_reaction', body: { user_id: 'user' } } });
    expect(notice.conversation).toBeUndefined();
  });

  // https://developer.kookapp.cn/doc/event/direct-message
  it('preserves chat_code without treating it or the reactor as a private peer id', () => {
    const notice = receive({ type: 255, channel_type: 'PERSON', target_id: 'bot', author_id: '1',
      extra: { type: 'private_added_reaction', body: { user_id: 'reactor', chat_code: 'chat', msg_id: 'message' } } });
    expect(notice.name).toBe('notice.friend.emoji_reaction');
    expect(notice.conversation).toBeUndefined();
    expect(notice.actor?.id).toBe('reactor');
    expect(notice.metadata).toMatchObject({ extra: { body: { chat_code: 'chat' } } });
  });
});
