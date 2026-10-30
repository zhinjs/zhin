import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';
import { currentGuildChannel } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '禁言 / 解除禁言当前 QQ 频道中的成员；需机器人具备频道管理权限',
  adapter: 'qq',
  scopes: ['channel'],
  tags: ['qq'],
  permissions: [platformPermission('qq', 'guild_admin')],
  requiresApproval: 'always',
  risk: 'dangerous',
  riskCategory: 'member',
  inputSchema: z.object({
    user_id: z.string().min(1).describe('目标成员用户 ID'),
    duration: z.number().int().min(0).default(0).describe('禁言秒数，0 = 解除禁言'),
  }),
  async execute({ user_id, duration }, context) {
    const { guildId } = currentGuildChannel(context);
    const members = context.$client.memberService;
    const seconds = duration ?? 0;
    const ok = seconds === 0
      ? await members.unmuteGuildMember(guildId, user_id)
      : await members.muteGuildMember(guildId, user_id, seconds);
    if (ok === false) return { success: false, message: t(context.locale, 'operationFailed') };
    return { success: true, message: seconds === 0 ? t(context.locale, 'unmuted', { user: user_id }) : t(context.locale, 'muted', { user: user_id, seconds }) };
  },
});
