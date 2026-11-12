import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ url: string; thread_count?: number }>({
  description: '下载文件到 NapCat 缓存目录，返回本地路径（写入宿主文件、由宿主发起网络请求，仅全局主人可用）。',
  inputSchema: z.object({
    url: z.string().describe('文件 URL'),
    thread_count: z.number().optional().describe('下载线程数（可选，默认 1）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['下载', 'download', '下载文件'],
  // Fetches any URL from the host network and writes the host file system: host-global (ADR 0056 §2).
  permissions: ['owner@global'],
  async execute({ url, thread_count }: { url: string; thread_count?: number }, context) {
    const endpoint = context.$client;
      return endpoint.downloadFile(url, thread_count || 1);
  },
});
