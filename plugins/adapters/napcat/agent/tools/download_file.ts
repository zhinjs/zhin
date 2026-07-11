import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; url: string; thread_count?: number }>({
  description: '下载文件到 NapCat 缓存目录，返回本地路径。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    url: z.string().describe('文件 URL'),
    thread_count: z.number().optional().describe('下载线程数（可选，默认 1）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['下载', 'download', '下载文件'],
  async execute({ endpoint_id, url, thread_count }: { endpoint_id: string; url: string; thread_count?: number }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.downloadFile(url, thread_count || 1);
  },
});
