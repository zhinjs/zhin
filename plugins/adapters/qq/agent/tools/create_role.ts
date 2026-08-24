import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; name: string; color?: number }>({
  description: '创建 QQ 频道角色',
  inputSchema: z.object({
    guild_id: z.string().describe('频道 ID'),
    name: z.string().describe('角色名称'),
    color: z.number().optional().describe('颜色（RGB 十进制数值）'),
  }),
  adapter: 'qq',
  tags: ['qq'],
  permissions: [platformPermit('guild_owner')],
  async execute({ guild_id, name, color  }: { guild_id: string; name: string; color?: number }, context) {
    const client = context.$client;
    const role = await client.createGuildRole(guild_id, name, color);
    return { success: !!role, role, message: role ? `角色 "${name}" 创建成功` : '创建失败' };
  },
});
