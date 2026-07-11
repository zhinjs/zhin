import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; group_id: number; file: string; name: string; folder?: string }>({
  description: '上传文件到群。file 为本地路径或 URL。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    file: z.string().describe('文件路径或 URL'),
    name: z.string().describe('文件名'),
    folder: z.string().optional().describe('目标文件夹 ID（可选）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['上传文件', 'upload file', '群文件'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, file, name, folder }: { endpoint_id: string; group_id: number; file: string; name: string; folder?: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.uploadGroupFile(group_id, file, name, folder);
      return { success: true };
  },
});
