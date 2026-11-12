import { messages as t } from "../../../../messages.js";
import { currentGuild, requireMemberBelowRequester } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ action: 'add' | 'remove'; user_id: string; remark?: string }>({
  description: '当前 KOOK 服务器的黑名单管理：添加/移除（只能拉黑角色低于你的成员）',
  inputSchema: z.object({
    action: z.enum(['add', 'remove']).describe('add|remove'),
    user_id: z.string().describe('用户 ID'),
    remark: z.string().optional().describe('备注（add 可选）'),
  }),
  adapter: 'kook',
  scopes: ["channel"],
  tags: ['kook'],
  permissions: ['platform:admin', 'bot-permission:ban_members'],
  async execute({ action, user_id, remark }, context) {
    const guildId = currentGuild(context);
    const member = context.$client.pickGuildMember(guildId, user_id);
    switch (action) {
      case 'add': {
        const denied = await requireMemberBelowRequester(context, guildId, user_id);
        if (denied) return { success: false, message: denied };
        const success = await member.addToBlackList(remark);
        return { success, message: success ? t(context.locale, 'blacklisted', { p0: user_id }) : t(context.locale, 'operationFailed') };
      }
      case 'remove': {
        const success = await member.removeFromBlackList();
        return { success, message: success ? t(context.locale, 'unblacklisted', { p0: user_id }) : t(context.locale, 'operationFailed') };
      }
      default:
        return { success: false, message: t(context.locale, 'unknownAction', { p0: action }) };
    }
  },
});
