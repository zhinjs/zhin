import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getQqAgentDeps } from '../../src/qq-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; channel_id: string; user_id: string; role_id: string }>({
  description: '给成员添加 QQ 频道角色',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('频道 ID'),
    channel_id: z.string().describe('子频道 ID'),
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  platforms: ['qq'],
  tags: ['qq'],
  permissions: [platformPermit('manage_roles')],
  async execute({ endpoint_id, guild_id, channel_id, user_id, role_id  }: { endpoint_id: string; guild_id: string; channel_id: string; user_id: string; role_id: string }) {
    const endpoint = getQqAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.addMemberRole(guild_id, channel_id, user_id, role_id);
    return { success, message: success ? '已给成员添加角色' : '操作失败' };
  },
});
