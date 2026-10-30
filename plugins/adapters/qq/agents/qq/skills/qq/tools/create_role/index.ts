import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{ guild_id: string; name: string; color?: number }>({
  description: '创建 QQ 频道角色',
  inputSchema: z.object({
    guild_id: z.string().describe('频道 ID'),
    name: z.string().describe('角色名称'),
    color: z.number().optional().describe('颜色（RGB 十进制数值）'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: [platformPermission('qq', 'guild_owner')],
  async execute({ guild_id, name, color  }: { guild_id: string; name: string; color?: number }, context) {
    const client = context.$client;
    const role = await client.guildService.createRole(guild_id, { name, color: color || 0, hoist: 0 });
    return { success: !!role, role, message: role ? t(context.locale, 'namedRoleCreated', { p0: name }) : t(context.locale, 'createFailed') };
  },
});
