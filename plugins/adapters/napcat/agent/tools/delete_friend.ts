import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; user_id: number }>({
  description: '删除好友。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.number().describe('好友 QQ 号'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['删除好友', 'delete friend', '删好友'],
  permissions: ['platform(napcat,scene_admin)'],
  async execute({ endpoint_id, user_id }: { endpoint_id: string; user_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.deleteFriend(user_id);
      return { success: true };
  },
});
