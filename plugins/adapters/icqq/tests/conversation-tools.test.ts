import { genDmMessageId, genGroupMessageId } from '@icqqjs/icqq';
import { rootPluginId } from 'zhin.js';
import { outboundMessageToken } from '@zhin.js/core/runtime';
import { formatOutboundBody, formatOutboundMessages } from '../src/protocol.js';
import { toCanonicalSegments } from '@zhin.js/core';
import info from '../agents/icqq/skills/icqq-conversation/tools/conversation_info/index.js';
import quote from '../agents/icqq/skills/icqq-messages/tools/quote_reply/index.js';
import forward from '../agents/icqq/skills/icqq-messages/tools/forward_messages/index.js';
import ownRecall from '../agents/icqq/skills/icqq-messages/tools/recall_own_message/index.js';
import memberRecall from '../agents/icqq/skills/icqq-group-admin/tools/recall_member_message/index.js';
import leave from '../agents/icqq/skills/icqq-group-admin/tools/group_leave/index.js';
import type { IcqqToolContext } from '../agents/icqq/conversation.js';

function fixture(kind: 'private' | 'group' | 'channel' = 'group') {
  const abort = new AbortController();
  const groupId = 100;
  const self = { role: 'member' };
  const member = { role: 'member' };
  const id = kind === 'private' ? genDmMessageId(2, 1, 2, 1700000000, 1)
    : genGroupMessageId(groupId, 7, 1, 2, 1700000000, 1);
  const original = {
    message_id: id, message_type: kind, group_id: groupId, from_id: 7, to_id: 2,
    sender: { user_id: 7, nickname: 'Real author', group_id: undefined as number | undefined },
    message: [{ type: 'text', text: 'Original content' }], raw_message: 'Original content', time: 1700000000, seq: 1, rand: 2,
  };
  const group = { group_id: groupId, group_name: 'Group', owner_id: 9, member_count: 42 };
  const makeForwardMsg = vi.fn(async () => ({ type: 'json', data: { meta: { detail: { resid: 'native-resource', uniseq: 'native-file' } } } }));
  const client = {
    uin: 7, tiny_id: 'tiny-self', guilds: new Map(),
    getMsg: vi.fn(async () => original),
    getGroupInfo: vi.fn(async () => group),
    getGroupMemberInfo: vi.fn(async (_group: number, user: number) => user === 7 ? self : member),
    getGuildMemberList: vi.fn(async (): Promise<{ tiny_id: string; role: number }[]> => []),
    deleteMsg: vi.fn(async () => true), setGroupLeave: vi.fn(async () => true),
    pickGroup: vi.fn(() => ({ makeForwardMsg })), pickFriend: vi.fn(() => ({ makeForwardMsg })), pickMember: vi.fn(() => ({ makeForwardMsg })),
  };
  const conversation = { endpoint: { adapter: 'icqq', id: 'bot-7' }, kind,
    id: kind === 'group' ? String(groupId) : kind === 'private' ? '2' : 'channel',
    ...(kind === 'channel' ? { parent: { kind: 'channel' as const, id: 'guild' } } : {}),
  };
  const send = vi.fn(async (_request: unknown) => ({ status: 'sent' }));
  const context = {
    locale: 'en', $client: client, signal: abort.signal, owner: { id: rootPluginId() },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot-7', scope: kind, sceneId: conversation.id, conversation },
    principal: { subjectId: '2', roles: [] as string[] },
    use: (token: unknown) => { expect(token).toBe(outboundMessageToken); return { send }; },
  };
  return { id, original, self, member, group, client, abort, makeForwardMsg, send, context, ctx: context as unknown as IcqqToolContext };
}

describe('ICQQ current conversation tools', () => {
  it.each(['member', 'admin', 'owner'])('reports the bot role %s independently of requester roles', async role => {
    const f = fixture(); f.self.role = role; f.context.principal.roles = ['master'];
    expect(await info.execute({}, f.ctx)).toMatchObject({
      bot: { id: 7, role }, requester: { roles: ['master'], canRequestLeave: true },
      group: { id: 100, name: 'Group', memberCount: 42 },
    });
    expect(f.client.getGroupInfo).toHaveBeenCalledWith(100, true);
    expect(f.client.getGroupMemberInfo).toHaveBeenCalledWith(100, 7, true);
    f.client.uin = 8; // Same room, another endpoint account: no shared role snapshot.
    expect(await info.execute({}, f.ctx)).toMatchObject({ bot: { id: 8, role: 'member' } });
  });

  it('does not claim a member role when a live lookup fails', async () => {
    const f = fixture(); f.client.getGroupMemberInfo.mockRejectedValue(new Error('offline'));
    await expect(info.execute({}, f.ctx)).rejects.toThrow('offline');
  });

  it.each([[undefined, 'unknown'], [1, 'member'], [2, 'admin'], [4, 'owner'], [5, 'channel_admin']] as const)(
    'reports guild role %s without inferring child-channel authority', async (role, expected) => {
      const f = fixture('channel');
      f.client.getGuildMemberList.mockResolvedValue(role ? [{ tiny_id: 'tiny-self', role }] : []);
      expect(await info.execute({}, f.ctx)).toMatchObject({
        bot: { id: 'tiny-self', role: expected, channelAdminScope: 'unknown' },
        operations: { quoteReply: false, recallOwnMessage: false, leaveGroup: false },
      });
    });

  it.each(['group', 'private'] as const)('recalls own %s speech without role lookup or approval', async kind => {
    const f = fixture(kind);
    expect(ownRecall.requiresApproval).toBe('never');
    expect(ownRecall.permissions ?? []).toEqual([]);
    expect(await ownRecall.execute({ message_id: f.id }, f.ctx)).toMatchObject({ success: true });
    expect(f.client.deleteMsg).toHaveBeenCalledExactlyOnceWith(f.id);
    expect(f.client.getGroupMemberInfo).not.toHaveBeenCalled();
  });

  it('does not let the own-message tool recall another person', async () => {
    const f = fixture(); f.original.sender.user_id = 2;
    expect(await ownRecall.execute({ message_id: f.id }, f.ctx)).toMatchObject({ success: false });
    expect(f.client.deleteMsg).not.toHaveBeenCalled();
  });

  it('reports platform rejection once without inventing a time limit or retrying', async () => {
    const f = fixture(); f.client.deleteMsg.mockResolvedValue(false);
    expect(await ownRecall.execute({ message_id: f.id }, f.ctx)).toMatchObject({ success: false });
    expect(f.client.deleteMsg).toHaveBeenCalledOnce();
  });

  it.each([
    ['admin', 'member', true], ['owner', 'admin', true], ['owner', 'member', true],
    ['admin', 'admin', false], ['admin', 'owner', false], ['member', 'member', false], ['unknown', 'member', false],
  ])('checks live recall authority for %s over %s', async (self, target, allowed) => {
    const f = fixture(); f.original.sender.user_id = 2; f.self.role = String(self); f.member.role = String(target);
    expect(memberRecall.requiresApproval).toBe('never');
    expect(memberRecall.permissions).toEqual(['role(master,admin,trusted,owner)']);
    expect(await memberRecall.execute({ message_id: f.id, reason: 'Confirmed advertising' }, f.ctx)).toMatchObject({ success: allowed });
    expect(f.client.getGroupMemberInfo).toHaveBeenCalledWith(100, 2, true);
    expect(f.client.deleteMsg).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it('rejects foreign conversation IDs before reading history', async () => {
    const f = fixture();
    await expect(quote.execute({ message_id: genGroupMessageId(101, 7, 1, 2, 1700000000), text: 'reply' }, f.ctx)).rejects.toThrow('conversation');
    expect(f.client.getMsg).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects nearby history returned instead of the requested original', async () => {
    const f = fixture(); f.original.message_id = 'different';
    await expect(ownRecall.execute({ message_id: f.id }, f.ctx)).rejects.toThrow('verified');
    expect(f.client.deleteMsg).not.toHaveBeenCalled();
  });

  it('keeps a temporary private conversation separate from a friend conversation', async () => {
    const f = fixture('private'); f.original.sender.group_id = 100;
    await expect(quote.execute({ message_id: f.id, text: 'reply' }, f.ctx)).rejects.toThrow('conversation');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('quotes through the gateway and preserves suppressed receipts', async () => {
    const f = fixture(); f.send.mockResolvedValue({ status: 'suppressed' });
    expect(await quote.execute({ message_id: f.id, text: 'Reply' }, f.ctx)).toEqual({ success: false, receipt: { status: 'suppressed' } });
    expect(f.send).toHaveBeenCalledExactlyOnceWith({ requester: rootPluginId(), conversation: f.context.origin.conversation,
      content: [{ type: 'reply', data: { message_id: f.id }, platform: { icqqQuote: {
        user_id: 7, seq: 1, rand: 2, time: 1700000000, message: 'Original content',
      } } }, { type: 'text', data: { text: 'Reply' } }] });
  });

  it('quotes the actual author of an own private message instead of the peer encoded in its ID', async () => {
    const f = fixture('private');
    await quote.execute({ message_id: f.id, text: 'Correction' }, f.ctx);
    const request = f.send.mock.calls[0]![0] as { content: never };
    expect(formatOutboundBody(toCanonicalSegments(request.content))).toEqual([
      { type: 'quote', user_id: 7, seq: 1, rand: 2, time: 1700000000, message: 'Original content' }, 'Correction',
    ]);
  });

  it('forwards actual authors and content through canonical normalization to a native merged card', async () => {
    const f = fixture();
    expect(await forward.execute({ message_ids: [f.id] }, f.ctx)).toMatchObject({ success: true });
    expect(f.makeForwardMsg).toHaveBeenCalledExactlyOnceWith([{ user_id: 7, nickname: 'Real author', time: 1700000000, message: f.original.message }]);
    const request = f.send.mock.calls[0]![0] as { content: never; conversation: unknown };
    expect(request.conversation).toEqual(f.context.origin.conversation);
    expect(formatOutboundBody(toCanonicalSegments([request.content]))).toEqual({ type: 'multimsg', resid: 'native-resource', filename: 'native-file' });
    expect(formatOutboundMessages([{ type: 'text', data: { text: 'Before' } }, request.content]))
      .toEqual(['Before', { type: 'multimsg', resid: 'native-resource', filename: 'native-file' }]);
  });

  it('does not upload or send a forward if any original is outside this conversation', async () => {
    const f = fixture();
    await expect(forward.execute({ message_ids: [f.id, genGroupMessageId(101, 7, 1, 2, 1700000000)] }, f.ctx)).rejects.toThrow('conversation');
    expect(f.makeForwardMsg).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('leaves only the current group, with master and fresh-human requirements', async () => {
    const f = fixture();
    expect(leave.permissions).toEqual(['role(master)']); expect(leave.requiresApproval).toBe('human'); expect(leave.risk).toBe('dangerous');
    expect(await leave.execute({ group_id: 101, reason: 'Requested' }, f.ctx)).toMatchObject({ success: false });
    expect(f.client.getGroupInfo).not.toHaveBeenCalled();
    expect(await leave.execute({ group_id: 100, reason: 'Requested' }, f.ctx)).toMatchObject({ success: true });
    expect(f.client.setGroupLeave).toHaveBeenCalledExactlyOnceWith(100);
  });

  it.each(['owner-role', 'owner-id', 'unknown'])('refuses leaving when %s could dissolve a group', async condition => {
    const f = fixture();
    if (condition === 'owner-id') f.group.owner_id = 7;
    else f.self.role = condition === 'owner-role' ? 'owner' : 'unknown';
    expect(await leave.execute({ group_id: 100, reason: 'Requested' }, f.ctx)).toMatchObject({ success: false });
    expect(f.client.setGroupLeave).not.toHaveBeenCalled();
  });

  it('checks cancellation after asynchronous role reads', async () => {
    const f = fixture();
    f.client.getGroupInfo.mockImplementation(async () => { f.abort.abort(); return f.group; });
    await expect(leave.execute({ group_id: 100, reason: 'Requested' }, f.ctx)).rejects.toThrow();
    expect(f.client.setGroupLeave).not.toHaveBeenCalled();
  });

  it('does not send after cancellation during original-message lookup', async () => {
    const f = fixture();
    f.client.getMsg.mockImplementation(async () => { f.abort.abort(); return f.original; });
    await expect(quote.execute({ message_id: f.id, text: 'Reply' }, f.ctx)).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not send after cancellation during an uncancellable forward upload', async () => {
    const f = fixture();
    f.makeForwardMsg.mockImplementation(async () => {
      f.abort.abort(); return { type: 'json', data: { meta: { detail: { resid: 'resource', uniseq: 'file' } } } };
    });
    await expect(forward.execute({ message_ids: [f.id] }, f.ctx)).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('reports an unconfirmed leave once and preserves platform exceptions', async () => {
    const f = fixture(); f.client.setGroupLeave.mockResolvedValue(false);
    expect(await leave.execute({ group_id: 100, reason: 'Requested' }, f.ctx)).toMatchObject({ success: false });
    expect(f.client.setGroupLeave).toHaveBeenCalledOnce();
    f.client.deleteMsg.mockRejectedValue(new Error('Platform refused'));
    await expect(ownRecall.execute({ message_id: f.id }, f.ctx)).rejects.toThrow('Platform refused');
    expect(f.client.deleteMsg).toHaveBeenCalledOnce();
  });

  it('does not call QQ APIs for unsupported channels', async () => {
    const f = fixture('channel');
    await expect(ownRecall.execute({ message_id: f.id }, f.ctx)).rejects.toThrow('channel');
    expect(f.client.getMsg).not.toHaveBeenCalled(); expect(f.client.deleteMsg).not.toHaveBeenCalled();
  });
});
