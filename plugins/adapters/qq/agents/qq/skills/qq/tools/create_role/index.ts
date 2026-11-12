import { messages as t } from "../../../../messages.js";
import { currentGuildChannel } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ name: string; color?: number }>({
  description: '在当前 QQ 频道创建身份组',
  inputSchema: z.object({
    name: z.string().describe('角色名称'),
    color: z.number().optional().describe('颜色（RGB 十进制数值）'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:owner', 'bot:admin'],
  async execute({ name, color }, context) {
    const { guildId: guild_id } = currentGuildChannel(context);
    const client = context.$client;
    const role = await client.guildService.createRole(guild_id, { name, color: color || 0, hoist: 0 });
    return { success: !!role, role, message: role ? t(context.locale, 'namedRoleCreated', { p0: name }) : t(context.locale, 'createFailed') };
  },
});
