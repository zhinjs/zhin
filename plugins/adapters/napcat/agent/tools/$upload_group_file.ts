import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number; file: string; name: string; folder?: string }>({
  description: '上传文件到群。file 为本地路径或 URL。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
    file: z.string().describe('文件路径或 URL'),
    name: z.string().describe('文件名'),
    folder: z.string().optional().describe('目标文件夹 ID（可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['上传文件', 'upload file', '群文件'],
  scopes: ['group'],
  async execute({ group_id, file, name, folder }: { group_id: number; file: string; name: string; folder?: string }, context) {
    const endpoint = context.$client;
      await endpoint.uploadGroupFile(group_id, file, name, folder);
      return { success: true };
  },
});
