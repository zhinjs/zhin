import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool({
  description: '获取当前日期和时间',
  inputSchema: z.object({}),
  approval: 'never',
  async execute() {
    return new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
    });
  },
});
