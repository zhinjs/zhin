import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ user_ids: string; content: string }>({
  description: '向指定用户发送钉钉工作通知',
  inputSchema: z.object({
    user_ids: z.string().describe('用户 ID 列表，逗号分隔'),
    content: z.string().describe('通知内容'),
  }),
  adapter: 'dingtalk',
  tags: ['dingtalk'],
  async execute({ user_ids, content    }: { user_ids: string; content: string }, context) {
    const endpoint = context.$client;
    const msgContent = { msgtype: 'text', text: { content } };
    const success = await endpoint.sendWorkNotice(user_ids.split(','), msgContent);
    return { success, message: success ? '工作通知已发送' : '发送失败' };
  },
});

