import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentConversation } from '../../../../conversation.js';

/** Guild built-in role ids: 4 = owner, 2 = super admin, 5 = child-channel admin. */
function guildRole(roles: readonly unknown[] | undefined): string {
  const ids = (roles ?? []).map(String);
  if (ids.includes('4')) return 'owner';
  if (ids.includes('2')) return 'admin';
  if (ids.includes('5')) return 'channel_admin';
  return ids.length ? 'member' : 'unknown';
}

export default defineAgentTool({
  description: '读取当前 QQ 官方机器人会话及机器人自己的群／频道身份；区分调用者权限、机器人平台权限和官方不支持的操作',
  adapter: 'qq',
  requiresApproval: 'never',
  readOnly: true,
  inputSchema: z.object({}),
  async execute(_input, context) {
    const conversation = currentConversation(context);
    const roles = context.principal.roles;
    const common = {
      conversation,
      requester: {
        roles,
        canRequestGroupModeration: roles.some(role => ['master', 'admin', 'trusted', 'owner'].includes(role)),
      },
      operations: {
        quoteReply: true,
        recallOwnMessage: true,
        recallMemberMessage: conversation.kind === 'group' || conversation.kind === 'channel',
        reaction: conversation.kind === 'channel',
        // 官方 API 不提供：合并转发、戳一戳、点赞、退群、群公告、精华、头衔、匿名、群文件、群签到。
        forwardMessages: false,
        leaveGroup: false,
      },
    };
    const api = context.$client;
    if (conversation.kind === 'group') {
      const [state, info] = await Promise.all([
        api.groupService.getBotState(conversation.id),
        api.groupService.getInfo(conversation.id).catch(() => undefined),
      ]);
      context.signal.throwIfAborted();
      const role = state.member_role;
      return {
        ...common,
        group: { id: conversation.id, name: info?.group_name, memberCount: info?.group_member_num },
        bot: {
          id: state.member_openid,
          role,
          canModerateMembers: role === 'owner' || role === 'admin',
          allowProactiveMessage: state.allow_proactive_msg,
          receiveSetting: state.recv_msg_setting,
          joinedAt: state.joined_at,
        },
      };
    }
    if (conversation.kind === 'channel' && conversation.parent?.kind === 'channel') {
      const guildId = conversation.parent.id;
      const self = await api.botService.getSelfInfo();
      const member = self?.id
        ? await api.memberService.getGuildMemberInfo(guildId, String(self.id)).catch(() => undefined)
        : undefined;
      context.signal.throwIfAborted();
      return {
        ...common,
        guild: { id: guildId },
        channel: { id: conversation.id },
        bot: { id: self?.id, role: guildRole(member?.roles), channelAdminScope: 'unknown' },
      };
    }
    return { ...common, bot: { role: 'not_applicable' } };
  },
});
