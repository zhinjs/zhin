import { getAdapterLogger } from '@zhin.js/logger';
import type { IncomingNotice } from '@zhin.js/core';
import { receiveSlackSideEvent } from '../src/side-event-dispatch.js';
import { slackInboundConversation, type SlackEvent } from '../src/protocol.js';

const logger = getAdapterLogger('slack', 'test');
function receive(event: SlackEvent): IncomingNotice {
  const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
  receiveSlackSideEvent(emit, 'root/slack\0zhin.adapter\0bot', 'bot', event, logger);
  expect(emit).toHaveBeenCalledOnce();
  return emit.mock.calls[0]![1] as IncomingNotice;
}

describe('Slack notice conversation projection', () => {
  // https://docs.slack.dev/reference/events/reaction_added/
  it.each(['C123', 'D123'])('uses the nested reaction channel %s and message identity', (channel) => {
    const notice = receive({ type: 'reaction_removed', user: 'Uactor', item_user: 'Uauthor',
      item: { type: 'message', channel, ts: '123.456' }, reaction: 'thumbsup', event_ts: '1700000000.123' });
    expect(notice.conversation).toEqual(slackInboundConversation('root/slack\0zhin.adapter\0bot', { channelId: channel }));
    expect(notice).toMatchObject({ actor: { id: 'Uactor' }, target: { id: 'Uauthor' },
      messageId: '123.456', reaction: 'thumbsup', operation: 'removed', timestamp: 1700000000123 });
    expect(notice.name).toBe(`notice.${channel.startsWith('D') ? 'friend' : 'group'}.emoji_reaction`);
  });

  it.each<SlackEvent>([
    { type: 'reaction_added', user: 'Uactor', item: { type: 'file', file: 'F123' } },
    { type: 'member_joined_channel', user: 'Uactor' },
    { type: 'member_joined_channel' },
    { type: 'team_join', user: { id: 'Unew' } } as unknown as SlackEvent,
  ])('does not invent a conversation for %j', (event) => {
    expect(receive(event).conversation).toBeUndefined();
  });

  it('keeps workspace participants without inventing a DM', () => {
    const notice = receive({ type: 'team_join', user: { id: 'Unew' } } as unknown as SlackEvent);
    expect(notice.target).toEqual({ id: 'Unew', name: 'Unew' });
    expect(notice.actor).toBeUndefined();
  });
});
