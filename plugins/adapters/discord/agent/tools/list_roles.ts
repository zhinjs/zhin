import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getDiscordAgentDeps } from '../../src/discord-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string }>({
  description: '获取 Discord 服务器角色列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('服务器 ID'),
  }),
  platforms: ['discord'],
  tags: ['discord'],
  permissions: [platformPermit('manage_roles')],
  async execute({ endpoint_id, guild_id  }: { endpoint_id: string; guild_id: string }) {
    const endpoint = getDiscordAgentDeps().getGatewayEndpoint(endpoint_id) as {
      getRoles: (guildId: string) => Promise<unknown[]>;
    };
    const roles = await endpoint.getRoles(guild_id);
    return { roles, count: roles.length };
  },
});
