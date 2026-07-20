import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getQqAgentDeps } from '../../src/qq-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; name: string; color?: number }>({
  description: '创建 QQ 频道角色',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('频道 ID'),
    name: z.string().describe('角色名称'),
    color: z.number().optional().describe('颜色（RGB 十进制数值）'),
  }),
  platforms: ['qq'],
  tags: ['qq'],
  permissions: [platformPermit('guild_owner')],
  async execute({ endpoint_id, guild_id, name, color  }: { endpoint_id: string; guild_id: string; name: string; color?: number }) {
    const endpoint = getQqAgentDeps().getEndpoint(endpoint_id);
    const role = await endpoint.createGuildRole(guild_id, name, color);
    return { success: !!role, role, message: role ? `角色 "${name}" 创建成功` : '创建失败' };
  },
});
