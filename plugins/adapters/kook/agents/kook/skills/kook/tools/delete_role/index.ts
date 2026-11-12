import { messages as t } from "../../../../messages.js";
import { currentGuild } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ role_id: string }>({
  description: '删除当前 KOOK 服务器中的角色',
  inputSchema: z.object({
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'kook',
  scopes: ["channel"],
  tags: ['kook'],
  permissions: ['platform:owner', 'bot-permission:manage_roles'],
  async execute({ role_id }, context) {
    const client = context.$client;
    const success = await client.pickGuild(currentGuild(context)).deleteRole(role_id);
    return { success, message: success ? t(context.locale, 'roleDeleted', { p0: role_id }) : t(context.locale, 'roleDeleteFailed') };
  },
});
