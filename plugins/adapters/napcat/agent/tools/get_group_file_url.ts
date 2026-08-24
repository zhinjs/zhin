import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number; file_id: string; busid: number }>({
  description: '获取群文件下载链接。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
    file_id: z.string().describe('文件 ID'),
    busid: z.number().describe('文件类型 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['文件链接', 'file url', '下载文件'],
  scopes: ['group'],
  async execute({ group_id, file_id, busid }: { group_id: number; file_id: string; busid: number }, context) {
    const endpoint = context.$client;
      return endpoint.getGroupFileUrl(group_id, file_id, busid);
  },
});
