import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getQqAgentDeps } from '../../src/qq-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string }>({
  description: '获取 QQ 频道角色列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('频道 ID'),
  }),
  platforms: ['qq'],
  tags: ['qq'],
  permissions: [platformPermit('manage_roles')],
  async execute({ endpoint_id, guild_id  }: { endpoint_id: string; guild_id: string }) {
    const endpoint = getQqAgentDeps().getEndpoint(endpoint_id);
    const roles = await endpoint.getGuildRoles(guild_id);
    return { roles, count: roles.length };
  },
});
