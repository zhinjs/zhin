import { messages as t } from "../../../../messages.js";
import { currentGuild } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ user_id: string; role_id: string }>({
  description: '撤销当前 KOOK 服务器中用户的角色',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'kook',
  scopes: ["channel"],
  tags: ['kook'],
  permissions: ['platform-permission:manage_roles', 'bot-permission:manage_roles'],
  async execute({ user_id, role_id }, context) {
    const client = context.$client;
    const success = await client.pickGuildMember(currentGuild(context), user_id).revoke(role_id);
    return { success, message: success ? t(context.locale, 'roleRevoked', { p0: user_id, p1: role_id }) : t(context.locale, 'roleRevokeFailed') };
  },
});
