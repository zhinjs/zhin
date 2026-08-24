import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: number }>({
  description: '尝试给用户点尽量多的赞',
  inputSchema: z.object({
    user_id: z.number().describe('要点赞的目标用户 QQ号'),
  }),
  adapter: 'icqq',
  approval: 'never',
  async execute({ user_id }, context) {
    const successArray: number[] = [];
    await Promise.all([20, 20, 10].map(async (times) => {
      try {
        await context.$client.sendLike(user_id, times);
        successArray.push(times);
      } catch { /* ignore */ }
    }));
    const successTimes = successArray.reduce((a, b) => a + b, 0);
    if (!successTimes) return { success: false, message: '点赞失败' };
    return { success: true, message: `已给 ${user_id} 点赞 ${successTimes} 次` };
  },
});
