import { messages as t } from "../../../../messages.js";
import { currentGuild } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ name: string }>({
  description: '在当前 KOOK 服务器中创建新角色',
  inputSchema: z.object({
    name: z.string().describe('角色名称'),
  }),
  adapter: 'kook',
  scopes: ["channel"],
  tags: ['kook'],
  permissions: ['platform:owner', 'bot-permission:manage_roles'],
  async execute({ name }, context) {
    const client = context.$client;
    const role = await client.pickGuild(currentGuild(context)).createRole(name);
    return {
      success: true,
      message: t(context.locale, 'roleCreated', { p0: name }),
      role: { id: role.role_id, name: role.name },
    };
  },
});
