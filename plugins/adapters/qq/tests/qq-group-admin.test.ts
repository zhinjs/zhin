import { qqFixture } from './fixture.js';
import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { outboundMessageToken } from '@zhin.js/core/runtime';
import { capabilityId, featureId } from 'zhin.js';
import type { Bot } from 'qq-official-bot';
import { QqWebsocketEndpoint, parseQqEmoji, type QqBotTransport } from '../src/endpoint.js';
import { resolveQqConfig } from '../src/protocol.js';
import { inspectQqGroupMember, moderateQqGroupMember, muteQqGroupMember, QQ_GROUP_MUTE_MAX_SECONDS } from '../src/group-admin.js';
import info from '../agents/qq/skills/qq-conversation/tools/conversation_info/index.js';
import quote from '../agents/qq/skills/qq-messages/tools/quote_reply/index.js';
import ownRecall from '../agents/qq/skills/qq-messages/tools/recall_own_message/index.js';
import kick from '../agents/qq/skills/qq-group-admin/tools/group_kick/index.js';
import mute from '../agents/qq/skills/qq-group-admin/tools/set_mute/index.js';
import memberRecall from '../agents/qq/skills/qq-group-admin/tools/recall_member_message/index.js';
import joinRequest from '../agents/qq/skills/qq-group-admin/tools/handle_join_request/index.js';
import listMuted from '../agents/qq/skills/qq-group-state/tools/list_muted/index.js';
import type { QqToolContext } from '../agents/qq/conversation.js';

const GROUP = 'GROUP_OPENID';
const JOINED_AT = new Date(Date.now() - 60_000).toISOString();

function groupService() {
  return {
    getInfo: vi.fn(async () => ({ group_openid: GROUP, group_name: 'Group', group_member_num: 42 })),
    getBotState: vi.fn(async () => ({ member_openid: 'BOT', member_role: 'admin', allow_proactive_msg: false, recv_msg_setting: 'only_mention', joined_at: '2026-01-01T00:00:00+08:00' })),
    getMemberInfo: vi.fn(async (_g: string, user: string) => ({ member_openid: user, username: 'alice', member_role: 'member', bot: false, joined_at: JOINED_AT })),
    getMembers: vi.fn(async () => []),
    removeMembers: vi.fn(async () => ({ remove_members_result: 'success', add_to_member_blacklist_fail_openids: [] })),
    setMemberMute: vi.fn(async () => undefined),
    approveJoinRequest: vi.fn(async () => undefined),
    getMuteSetting: vi.fn(async () => ({ global_rule: { mode: 'none', schedule_rules: [], recurring_rules: [] }, members: [
      { member_openid: 'A', username: 'a', mute_expire_at: new Date(Date.now() + 60_000).toISOString() },
      { member_openid: 'B', username: 'b', mute_expire_at: new Date(Date.now() - 60_000).toISOString() },
    ] })),
  };
}

function fixture(kind: 'group' | 'private' | 'channel' = 'group') {
  const groups = groupService();
  const reactionService = { addGuildMessageReaction: vi.fn(async () => true), deleteGuildMessageReaction: vi.fn(async () => true) };
  const client = {
    groupService: groups, reactionService,
    recallGroupMessage: vi.fn(async () => true),
    recallPrivateMessage: vi.fn(async () => true),
    recallGuildMessage: vi.fn(async () => true),
  };
  const conversation = {
    endpoint: { adapter: 'qq', id: 'bot' }, kind, id: kind === 'group' ? GROUP : kind === 'private' ? 'USER' : 'CHANNEL',
    ...(kind === 'channel' ? { parent: { kind: 'channel' as const, id: 'GUILD' } } : {}),
  };
  const send = vi.fn(async (_request: unknown) => ({ status: 'sent' }));
  const context = {
    locale: 'en', $client: client, signal: new AbortController().signal, owner: { id: rootPluginId() },
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: kind, sceneId: conversation.id, conversation },
    principal: { subjectId: 'U', roles: ['admin'] as string[] },
    use: (token: unknown) => { expect(token).toBe(outboundMessageToken); return { send }; },
  };
  return { groups, client, send, reactionService, ctx: context as unknown as QqToolContext };
}

describe('QQ group management helpers', () => {
  it('mutes with an RFC3339 expiry, unmutes with del, and rejects >30 days', async () => {
    const { groups, client } = fixture();
    await muteQqGroupMember(client, GROUP, 'U1', 600);
    const [[, [add]]] = groups.setMemberMute.mock.calls as unknown as [[string, [{ op: string; mute_expire_at: string }]]];
    expect(add.op).toBe('add');
    expect(Date.parse(add.mute_expire_at)).toBeGreaterThan(Date.now() + 590_000);
    await muteQqGroupMember(client, GROUP, 'U1', 0);
    expect(groups.setMemberMute).toHaveBeenLastCalledWith(GROUP, [{ op: 'del', member_openid: 'U1', mute_expire_at: '' }]);
    await expect(muteQqGroupMember(client, GROUP, 'U1', QQ_GROUP_MUTE_MAX_SECONDS + 1)).rejects.toThrow(RangeError);
  });

  it('only lets an admin bot moderate ordinary human members', async () => {
    const { groups, client } = fixture();
    const signal = new AbortController().signal;
    await expect(inspectQqGroupMember(client, GROUP, 'U1', signal)).resolves.toMatchObject({ canModerate: true, platformRole: 'member' });
    groups.getMemberInfo.mockResolvedValueOnce({ member_openid: 'U1', username: 'x', member_role: 'admin', bot: false, joined_at: '' });
    await expect(inspectQqGroupMember(client, GROUP, 'U1', signal)).resolves.toMatchObject({ canModerate: false, platformRole: 'admin' });
    groups.getBotState.mockResolvedValueOnce({ member_openid: 'BOT', member_role: 'member', allow_proactive_msg: false, recv_msg_setting: 'all', joined_at: '' });
    await expect(inspectQqGroupMember(client, GROUP, 'U1', signal)).resolves.toMatchObject({ canModerate: false });
  });

  it('moderation kick re-checks the newcomer window and requires platform success', async () => {
    const { groups, client } = fixture();
    const signal = new AbortController().signal;
    const member = await inspectQqGroupMember(client, GROUP, 'U1', signal);
    await moderateQqGroupMember(client, GROUP, 'U1', { type: 'kick', joinedAt: member.joinedAt!, maxMembershipAgeMs: 600_000 }, signal, () => true);
    expect(groups.removeMembers).toHaveBeenCalledWith(GROUP, { member_openids: ['U1'] });
    groups.removeMembers.mockResolvedValueOnce({ remove_members_result: 'failed', add_to_member_blacklist_fail_openids: [] });
    await expect(moderateQqGroupMember(client, GROUP, 'U1', { type: 'kick', joinedAt: member.joinedAt!, maxMembershipAgeMs: 600_000 }, signal, () => true))
      .rejects.toThrow('did not confirm');
    await expect(moderateQqGroupMember(client, GROUP, 'U1', { type: 'mute', durationSeconds: 60 }, signal, () => false))
      .rejects.toThrow('permission');
  });
});

describe('QQ endpoint management and control', () => {
  const adapterFeature = featureId('zhin.adapter');
  const config = resolveQqConfig({ id: 'qq-bot', appid: 'a', secret: 's', mode: 'websocket' }) as ReturnType<typeof resolveQqConfig> & { mode: 'websocket' };

  async function endpoint() {
    const f = fixture();
    const bot = {
      ...f.client, start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), on: vi.fn(), removeAllListeners: vi.fn(),
    } as unknown as QqBotTransport;
    return { f, endpoint: await qqFixture(() => new QqWebsocketEndpoint({ id: capabilityId(rootPluginId(), adapterFeature, 'qq'), config }), () => bot) };
  }

  it('exposes group member list, kick and mute as management capabilities', async () => {
    const { f, endpoint: ep } = await endpoint();
    await ep.start();
    try {
      await ep.management.listGroupMembers?.(GROUP);
      expect(f.groups.getMembers).toHaveBeenCalledWith(GROUP);
      await ep.management.kickGroupMember?.(GROUP, 'U1');
      expect(f.groups.removeMembers).toHaveBeenCalled();
      await ep.management.muteGroupMember?.(GROUP, 'U1', 0);
      expect(f.groups.setMemberMute).toHaveBeenCalled();
      await expect(ep.management.inspectGroupScene?.(GROUP, new AbortController().signal)).resolves.toEqual({ name: 'Group', memberCount: 42 });
    } finally { await ep.stop(); }
  });

  it('recalls native inbound IDs via the MessageRef conversation and reacts only in guild channels', async () => {
    const { f, endpoint: ep } = await endpoint();
    await ep.start();
    try {
      const group = { endpoint: { id: 'qq-bot', adapter: 'qq' }, kind: 'group' as const, id: GROUP };
      await ep.control.recall?.({ conversation: group, id: 'NATIVE-MSG' });
      expect(f.client.recallGroupMessage).toHaveBeenCalledWith(GROUP, 'NATIVE-MSG');
      expect(await ep.control.addReaction?.({ conversation: group, id: 'NATIVE-MSG' }, '⏳')).toBeNull();
      const channel = { endpoint: { id: 'qq-bot', adapter: 'qq' }, kind: 'channel' as const, id: 'CH', parent: { kind: 'channel' as const, id: 'G' } };
      const reaction = await ep.control.addReaction?.({ conversation: channel, id: 'M1' }, '⏳');
      expect(reaction).toBe('2:9203');
      expect(f.reactionService.addGuildMessageReaction).toHaveBeenCalledWith('CH', 'M1', 2, '9203');
      await ep.control.removeReaction?.({ conversation: channel, id: 'M1' }, reaction!);
      expect(f.reactionService.deleteGuildMessageReaction).toHaveBeenCalledWith('CH', 'M1', 2, '9203');
    } finally { await ep.stop(); }
  });

  it('parses explicit and unicode emoji', () => {
    expect(parseQqEmoji('1:4')).toEqual({ type: 1, id: '4' });
    expect(parseQqEmoji('👍')).toEqual({ type: 2, id: '128077' });
    expect(parseQqEmoji('ok')).toBeNull();
  });
});

describe('QQ agent tools', () => {
  it('conversation_info reports the live bot role and official gaps', async () => {
    const f = fixture();
    await expect(info.execute({}, f.ctx)).resolves.toMatchObject({
      bot: { id: 'BOT', role: 'admin', canModerateMembers: true },
      group: { id: GROUP, name: 'Group', memberCount: 42 },
      operations: { forwardMessages: false, leaveGroup: false, recallMemberMessage: true },
    });
  });

  it('quote_reply sends a reply segment through the unified pipeline', async () => {
    const f = fixture();
    await expect(quote.execute({ message_id: 'NATIVE', text: 'hi' }, f.ctx)).resolves.toMatchObject({ success: true });
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ content: [
      { type: 'reply', data: { message_id: 'NATIVE' } }, { type: 'text', data: { text: 'hi' } },
    ] }));
  });

  it('recall_own_message accepts only own receipts from the current conversation', async () => {
    const f = fixture();
    await expect(ownRecall.execute({ message_id: 'NATIVE' }, f.ctx)).resolves.toMatchObject({ success: false });
    await expect(ownRecall.execute({ message_id: 'group-OTHER:abc' }, f.ctx)).rejects.toThrow('does not belong');
    await expect(ownRecall.execute({ message_id: `group-${GROUP}:abc` }, f.ctx)).resolves.toMatchObject({ success: true });
    expect(f.client.recallGroupMessage).toHaveBeenCalledWith(GROUP, 'abc');
  });

  it('recall_member_message requires a manager bot in groups', async () => {
    const f = fixture();
    await expect(memberRecall.execute({ message_id: 'NATIVE', reason: 'spam' }, f.ctx)).resolves.toMatchObject({ success: true });
    f.groups.getBotState.mockResolvedValueOnce({ member_openid: 'BOT', member_role: 'member', allow_proactive_msg: false, recv_msg_setting: 'all', joined_at: '' });
    await expect(memberRecall.execute({ message_id: 'NATIVE', reason: 'spam' }, f.ctx)).resolves.toMatchObject({ success: false });
    f.client.recallGroupMessage.mockRejectedValueOnce(new Error('40064004'));
    await expect(memberRecall.execute({ message_id: 'NATIVE', reason: 'spam' }, f.ctx)).resolves.toMatchObject({ success: false, error: '40064004' });
  });

  it('group_kick and set_mute refuse non-member targets and only act in the current group', async () => {
    const f = fixture();
    expect(kick.requiresApproval).toBe('human');
    await expect(kick.execute({ user_id: 'U1', reason: 'ads', blacklist: true }, f.ctx)).resolves.toMatchObject({ success: true });
    expect(f.groups.removeMembers).toHaveBeenCalledWith(GROUP, { member_openids: ['U1'], add_to_member_blacklist: true });
    f.groups.getMemberInfo.mockResolvedValueOnce({ member_openid: 'U2', username: 'x', member_role: 'owner', bot: false, joined_at: '' });
    await expect(kick.execute({ user_id: 'U2', reason: 'ads', blacklist: false }, f.ctx)).resolves.toMatchObject({ success: false });
    await expect(mute.execute({ user_id: 'U1', duration: 60 }, f.ctx)).resolves.toMatchObject({ success: true });
    await expect(kick.execute({ user_id: 'U1', reason: 'x', blacklist: false }, fixture('private').ctx)).rejects.toThrow('current QQ group');
  });

  it('handle_join_request and list_muted use the official group APIs', async () => {
    const f = fixture();
    await joinRequest.execute({ user_id: 'U9', join_request_id: 'R1', approve: false, reason: 'no', blacklist: true }, f.ctx);
    expect(f.groups.approveJoinRequest).toHaveBeenCalledWith(GROUP, 'U9', { op: 'decline', join_request_id: 'R1', reject_reason: 'no', add_to_member_blacklist: true });
    await expect(listMuted.execute({}, f.ctx)).resolves.toMatchObject({ count: 1, muted_members: [{ member_openid: 'A' }] });
  });
});
