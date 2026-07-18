import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getKookAgentDeps } from '../../src/kook-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; name: string }>({
  description: '在 KOOK 服务器中创建新角色',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('服务器 ID'),
    name: z.string().describe('角色名称'),
  }),
  platforms: ['kook'],
  tags: ['kook'],
  permissions: [platformPermit('guild_owner')],
  async execute({ endpoint_id, guild_id, name  }: { endpoint_id: string; guild_id: string; name: string }) {
    const endpoint = getKookAgentDeps().getEndpoint(endpoint_id);
    const role = await endpoint.createRole(guild_id, name);
    return {
      success: true,
      message: `已创建角色 "${name}"`,
      role: { id: role.role_id, name: role.name },
    };
  },
});
