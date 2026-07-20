import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getKookAgentDeps } from '../../src/kook-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; role_id: string }>({
  description: '删除 KOOK 服务器中的角色',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('服务器 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  platforms: ['kook'],
  tags: ['kook'],
  permissions: [platformPermit('guild_owner')],
  async execute({ endpoint_id, guild_id, role_id  }: { endpoint_id: string; guild_id: string; role_id: string }) {
    const endpoint = getKookAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.deleteRole(guild_id, role_id);
    return { success, message: success ? `已删除角色 ${role_id}` : '删除角色失败' };
  },
});
