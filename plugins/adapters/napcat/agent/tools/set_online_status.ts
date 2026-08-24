import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ status: number; ext_status?: number }>({
  description: '设置在线状态（在线、隐身、忙碌等）。',
  inputSchema: z.object({
    status: z.number().describe('状态码（11=在线, 21=离开, 31=隐身, 41=忙碌, 50=请勿打扰, 60=Q我吧）'),
    ext_status: z.number().optional().describe('扩展状态码'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['在线状态', '隐身', '忙碌', 'online', 'status'],
  async execute({ status, ext_status }: { status: number; ext_status?: number }, context) {
    const endpoint = context.$client;
      await endpoint.setOnlineStatus(status, ext_status || 0);
      return { success: true };
  },
});
