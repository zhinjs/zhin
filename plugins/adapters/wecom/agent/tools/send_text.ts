import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ user_id: string; content: string }>({
  description: '向指定企业微信用户发送文本消息',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
    content: z.string().describe('消息内容'),
  }),
  adapter: 'wecom',
  tags: ['wecom'],
  async execute({ user_id, content    }: { user_id: string; content: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.sendTextMessage(user_id, content);
    return { success, message: success ? '消息已发送' : '发送失败' };
  },
});

