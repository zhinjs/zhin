import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; group_id: number; content: string; image?: string }>({
  description: '发送群公告。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    content: z.string().describe('公告内容'),
    image: z.string().optional().describe('图片（URL 或 base64，可选）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['群公告', 'notice', '公告', '发公告'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, content, image }: { endpoint_id: string; group_id: number; content: string; image?: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.sendGroupNotice(group_id, content, image);
      return { success: true };
  },
});
