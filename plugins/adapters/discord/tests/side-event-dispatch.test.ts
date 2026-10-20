import { getAdapterLogger } from '@zhin.js/logger';
import { receiveDiscordGuildMemberSideEvent } from '../src/side-event-dispatch.js';

it('keeps guild membership without inventing a replyable Discord channel', () => {
  const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
  receiveDiscordGuildMemberSideEvent(emit, 'bot', 'member_increase', {
    guildId: 'guild', userId: 'member', userName: 'Member',
  }, getAdapterLogger('discord', 'test'));
  expect(emit).toHaveBeenCalledWith('notice.receive', expect.objectContaining({
    name: 'notice.group.member_increase', target: { id: 'member', name: 'Member' },
    metadata: { guildId: 'guild', userId: 'member', userName: 'Member' },
  }));
  expect(emit.mock.calls[0]?.[1]).not.toHaveProperty('conversation');
});
