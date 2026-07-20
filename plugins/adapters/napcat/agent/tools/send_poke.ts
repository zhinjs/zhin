import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; user_id: number; group_id?: number }>({
  description: '戳一戳（群聊或私聊）。group_id 不传时为私聊戳一戳。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.number().describe('目标用户 QQ 号'),
    group_id: z.number().optional().describe('群号（不传则为私聊戳一戳）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['戳一戳', 'poke', '戳', '拍一拍'],
  async execute({ endpoint_id, user_id, group_id }: { endpoint_id: string; user_id: number; group_id?: number }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.sendPoke(user_id, group_id);
      return { success: true, message: `已戳 ${user_id}` };
  },
});
