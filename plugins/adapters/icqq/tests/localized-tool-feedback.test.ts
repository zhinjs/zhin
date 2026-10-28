import poll from '../../telegram/agents/telegram/skills/telegram-messages/tools/send_poll/index.js';
import archive from '../../slack/agents/slack/skills/slack-channels/tools/archive_channel/index.js';
import managers from '../../lark/agents/lark/skills/lark-group-admin/tools/set_managers/index.js';
import mute from '../agents/icqq/skills/icqq-group-admin/tools/set_mute/index.js';

it('localizes tool validation and preserves the provider input and single-call behavior', async () => {
  const sendPoll = vi.fn().mockResolvedValue({ message_id: 42 });
  const context = { locale: 'en', $client: { sendPoll } };
  expect(await poll.execute({ chat_id: '123', question: '原文', options: 'not-json' }, context as never))
    .toEqual({ success: false, message: 'options must be a JSON array' });
  expect(sendPoll).not.toHaveBeenCalled();
  expect(await poll.execute({ chat_id: '123', question: '原文', options: '["中文","English"]' }, context as never))
    .toMatchObject({ message: 'Poll sent', message_id: 42 });
  expect(sendPoll).toHaveBeenCalledOnce();
  expect(sendPoll).toHaveBeenCalledWith(123, '原文', ['中文', 'English'], true, false);
});

it('keeps trusted operation locale independent of platform administration results', async () => {
  const archiveChannel = vi.fn().mockResolvedValue({});
  expect(await archive.execute({ channel: 'C123' }, { locale: 'en', $client: { conversations: { archive: archiveChannel } } } as never))
    .toMatchObject({ message: 'Channel archived' });
  expect(archiveChannel).toHaveBeenCalledOnce();
  const setChatManagers = vi.fn().mockResolvedValue(false);
  expect(await managers.execute({ chat_id: 'group', user_ids: 'u1,u2' }, { locale: 'en', $client: { setChatManagers } } as never))
    .toEqual({ success: false, message: 'Update failed' });
  expect(setChatManagers).toHaveBeenCalledOnce();
});

it('localizes mute/unmute outcomes without weakening the existing platform role check', async () => {
  const setGroupBan = vi.fn();
  const client = { uin: 7, getGroupMemberInfo: vi.fn().mockResolvedValue({ role: 'admin' }), setGroupBan };
  expect(await mute.execute({ group_id: 1, user_id: 2, duration: 0 }, { locale: 'en', $client: client } as never))
    .toMatchObject({ message: 'Unmuted member 2' });
  expect(await mute.execute({ group_id: 1, user_id: 2, duration: 60 }, { locale: 'en', $client: client } as never))
    .toMatchObject({ message: 'Muted member 2 (60 seconds)' });
  client.getGroupMemberInfo.mockResolvedValue({ role: 'member' });
  expect(await mute.execute({ group_id: 1, user_id: 2, duration: 60 }, { locale: 'en', $client: client } as never))
    .toMatchObject({ success: false, message: 'The bot must be a group owner or administrator to mute or unmute members' });
  expect(setGroupBan).toHaveBeenCalledTimes(2);
});
