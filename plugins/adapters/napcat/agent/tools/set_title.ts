import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; group_id: number; user_id: number; title: string }>({
  description: '设置群成员专属头衔。需要群主权限。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    user_id: z.number().describe('目标成员 QQ 号'),
    title: z.string().describe('头衔文字'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['头衔', 'title', '专属头衔', '设置头衔'],
  permissions: ['platform(napcat,scene_owner)'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, user_id, title }: { endpoint_id: string; group_id: number; user_id: number; title: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.setTitle(group_id, user_id, title);
      return { success: true, message: `已设置 ${user_id} 头衔为 "${title}"` };
  },
});
