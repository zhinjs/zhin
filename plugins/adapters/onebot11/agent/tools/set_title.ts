import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getOnebot11AgentDeps } from '../../src/onebot11-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number; title: string }>({
  description: '设置 QQ 群成员的专属头衔。只有群主才能设置。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    title: z.string().describe('头衔文字'),
  }),
  platforms: ['onebot11'],
  tags: ['onebot11'],
  permissions: ['platform(onebot11,scene_owner)'],
  async execute({ endpoint_id, group_id, user_id, title    }: { endpoint_id: string; group_id: number; user_id: number; title: string }) {
    const endpoint = getOnebot11AgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.setTitle(group_id, user_id, title);
    return { success, message: success ? `已将 ${user_id} 的头衔设为 "${title}"` : '设置失败' };
  },
});

