import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; type: string; title: string; desc: string; pic_url: string; jump_url: string }>({
  description: '签名小程序卡片（如 B 站分享卡片等）。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    type: z.string().describe('卡片类型'),
    title: z.string().describe('标题'),
    desc: z.string().describe('描述'),
    pic_url: z.string().describe('图片 URL'),
    jump_url: z.string().describe('跳转 URL'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['小程序', 'mini app', '卡片', 'ark'],
  async execute({ endpoint_id, type, title, desc, pic_url, jump_url }: { endpoint_id: string; type: string; title: string; desc: string; pic_url: string; jump_url: string }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.getMiniAppArk(type, title, desc, pic_url, jump_url);
  },
});
