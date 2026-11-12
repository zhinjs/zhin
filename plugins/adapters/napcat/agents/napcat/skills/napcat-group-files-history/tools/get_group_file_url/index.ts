import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ file_id: string; busid: number }>({
  description: '获取当前群的群文件下载链接。',
  inputSchema: z.object({
    file_id: z.string().describe('文件 ID'),
    busid: z.number().describe('文件类型 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['文件链接', 'file url', '下载文件'],
  scopes: ['group'],
  async execute({ file_id, busid }, context) {
    return context.$client.getGroupFileUrl(currentGroup(context), file_id, busid);
  },
});
