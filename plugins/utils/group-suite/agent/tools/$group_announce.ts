import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ message: string }>({
  description: '向群聊发送公告/通知消息',
  inputSchema: z.object({ message: z.string().min(1) }),
  keywords: ['群公告', '通知', 'announce'],
  async execute({ message }) {
    if (!message?.trim()) return '公告内容不能为空';
    return `📢 群公告：\n${message}`;
  },
});
