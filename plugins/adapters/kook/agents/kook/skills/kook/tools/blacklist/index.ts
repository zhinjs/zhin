import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{ guild_id: string; action: 'add' | 'remove'; user_id: string; remark?: string }>({
  description: 'KOOK 服务器黑名单管理：添加/移除',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
    action: z.enum(['add', 'remove']).describe('add|remove'),
    user_id: z.string().describe('用户 ID'),
    remark: z.string().optional().describe('备注（add 可选）'),
  }),
  adapter: 'kook',
  scopes: ["channel"],
  tags: ['kook'],
  permissions: [platformPermission('kook', 'guild_admin')],
  async execute({ guild_id, action, user_id, remark }: { guild_id: string; action: 'add' | 'remove'; user_id: string; remark?: string }, context) {
    const member = context.$client.pickGuildMember(guild_id, user_id);
    switch (action) {
      case 'add': {
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
