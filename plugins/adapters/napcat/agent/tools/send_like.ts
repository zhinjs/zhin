import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; user_id: number; times?: number }>({
  description: '给好友点赞（每人每天最多 10 次）。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.number().describe('目标 QQ 号'),
    times: z.number().optional().describe('点赞次数（1-10）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['点赞', 'like', '赞', '好友赞'],
  async execute({ endpoint_id, user_id, times }: { endpoint_id: string; user_id: number; times?: number }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.sendLike(user_id, times || 1);
      return { success: true, message: `已给 ${user_id} 点赞 ${times || 1} 次` };
  },
});
