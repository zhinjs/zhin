import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; user_id: number; times?: number }>({
  description: '尝试给用户点尽量多的赞',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    user_id: z.number().describe('要点赞的目标用户 QQ号'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id, user_id }: { endpoint_id: string; user_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const successArray: number[] = [];
    await Promise.all([20, 20, 10].map(async (times) => {
      try {
        await endpoint.sendLike(user_id, times);
        successArray.push(times);
      } catch { /* ignore */ }
    }));
    const successTimes = successArray.reduce((a, b) => a + b, 0);
    if (!successTimes) return { success: false, message: '点赞失败' };
    return { success: true, message: `已给 ${user_id} 点赞 ${successTimes} 次` };
  },
});
