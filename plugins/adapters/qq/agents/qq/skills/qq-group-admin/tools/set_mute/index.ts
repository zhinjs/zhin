import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup, muteQqGroupMember, QQ_GROUP_MUTE_MAX_SECONDS, requireGroupManager } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '禁言 / 解除禁言当前 QQ 群中的普通成员（最长 30 天）；需机器人为群管理员',
  adapter: 'qq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'always',
  risk: 'dangerous',
  riskCategory: 'member',
  inputSchema: z.object({
    user_id: z.string().min(1).describe('目标成员 member_openid'),
    duration: z.number().int().min(0).max(QQ_GROUP_MUTE_MAX_SECONDS).default(0).describe('禁言秒数，0 = 解除禁言，最长 2592000（30 天）'),
  }),
  async execute({ user_id, duration }, context) {
    const group = currentGroup(context);
    const client = context.$client;
    const seconds = duration ?? 0;
    const [self, member] = await Promise.all([
      requireGroupManager(context, group),
      client.groupService.getMemberInfo(group, user_id),
    ]);
    if (!self) return { success: false, message: t(context.locale, 'botNotManager') };
    // 官方：新增 / 更新禁言只能作用于普通成员；解除不限制。
    if (member.member_openid !== user_id || (seconds > 0 && (member.member_role !== 'member' || member.bot))) {
      return { success: false, message: t(context.locale, 'targetNotMember') };
    }
    context.signal.throwIfAborted();
    await muteQqGroupMember(client, { groupId: group, userId: user_id, durationSeconds: seconds });
    const user = member.username || user_id;
    return { success: true, message: seconds === 0 ? t(context.locale, 'unmuted', { user }) : t(context.locale, 'muted', { user, seconds }) };
  },
});
