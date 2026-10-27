import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentConversation } from '../../../../conversation.js';

export default defineAgentTool({
  description: '读取当前 ICQQ 会话及机器人自己的群／频道身份；区分调用者权限、机器人平台权限和不支持的操作',
  adapter: 'icqq',
  requiresApproval: 'never',
  inputSchema: z.object({}),
  async execute(_input, context) {
    const conversation = currentConversation(context);
    const client = context.$client;
    const roles = context.principal.roles;
    const common = {
      conversation,
      requester: {
        roles,
        canRequestGroupModeration: roles.some(role => ['master', 'admin', 'trusted', 'owner'].includes(role)),
        canRequestLeave: roles.includes('master'),
      },
      operations: {
        quoteReply: conversation.kind !== 'channel',
        forwardMessages: conversation.kind !== 'channel',
        recallOwnMessage: conversation.kind !== 'channel',
        recallMemberMessage: conversation.kind === 'group',
        leaveGroup: conversation.kind === 'group',
      },
    };
    if (conversation.kind === 'group') {
      const id = Number(conversation.id);
      const [group, self] = await Promise.all([
        client.getGroupInfo(id, true),
        client.getGroupMemberInfo(id, client.uin, true),
      ]);
      context.signal.throwIfAborted();
      const role = group.owner_id === client.uin ? 'owner' : self.role;
      return {
        ...common,
        group: { id: group.group_id, name: group.group_name, ownerId: group.owner_id, memberCount: group.member_count },
        bot: { id: client.uin, role, canModerateMembers: role === 'owner' || role === 'admin', canLeave: role === 'admin' || role === 'member' },
      };
    }
    if (conversation.kind === 'channel') {
      const guildId = conversation.parent?.id;
      const guild = guildId ? client.guilds.get(guildId) : undefined;
      const channel = guild?.channels.get(conversation.id);
      const members = guildId ? await client.getGuildMemberList(guildId) : [];
      context.signal.throwIfAborted();
      const self = members.find(member => member.tiny_id === client.tiny_id);
      const role = self?.role === 4 ? 'owner' : self?.role === 2 ? 'admin'
        : self?.role === 5 ? 'channel_admin' : self?.role === 1 ? 'member' : 'unknown';
      return {
        ...common,
        guild: { id: guildId, name: guild?.guild_name },
        channel: { id: conversation.id, name: channel?.channel_name, type: channel?.channel_type },
        bot: { id: client.tiny_id, role, channelAdminScope: 'unknown' },
      };
    }
    return { ...common, bot: { id: client.uin, role: 'not_applicable' } };
  },
});
