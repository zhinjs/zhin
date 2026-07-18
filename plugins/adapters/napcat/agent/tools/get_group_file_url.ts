import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; group_id: number; file_id: string; busid: number }>({
  description: '获取群文件下载链接。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    file_id: z.string().describe('文件 ID'),
    busid: z.number().describe('文件类型 ID'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['文件链接', 'file url', '下载文件'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, file_id, busid }: { endpoint_id: string; group_id: number; file_id: string; busid: number }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.getGroupFileUrl(group_id, file_id, busid);
  },
});
