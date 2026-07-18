import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getQqAgentDeps } from '../../src/qq-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; user_id: string }>({
  description: '获取 QQ 频道中指定成员的详细信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('频道 ID'),
    user_id: z.string().describe('用户 ID'),
  }),
  platforms: ['qq'],
  tags: ['qq'],
  permissions: [platformPermit('guild_admin')],
  async execute({ endpoint_id, guild_id, user_id  }: { endpoint_id: string; guild_id: string; user_id: string }) {
    const endpoint = getQqAgentDeps().getEndpoint(endpoint_id);
    return endpoint.getGuildMember(guild_id, user_id);
  },
});
