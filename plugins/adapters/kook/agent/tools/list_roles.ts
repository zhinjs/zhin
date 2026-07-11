import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getKookAgentDeps } from '../../src/kook-agent-deps.js';

export default defineTool<{ endpoint_id: string; guild_id: string }>({
  description: '获取 KOOK 服务器的角色列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('服务器 ID'),
  }),
  platforms: ['kook'],
  tags: ['kook'],
  async execute({ endpoint_id, guild_id  }: { endpoint_id: string; guild_id: string }) {
    const endpoint = getKookAgentDeps().getEndpoint(endpoint_id);
    const roles = await endpoint.getRoleList(guild_id);
    return {
      roles: roles.map((r: { role_id: string; name: string; color: number; position: number; permissions: number }) => ({
        id: r.role_id,
        name: r.name,
        color: r.color,
        position: r.position,
        permissions: r.permissions,
      })),
      count: roles.length,
    };
  },
});
