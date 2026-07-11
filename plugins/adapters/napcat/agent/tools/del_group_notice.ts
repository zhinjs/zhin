import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; group_id: number; notice_id: string }>({
  description: '删除群公告。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
    notice_id: z.string().describe('公告 ID'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['删除公告', 'delete notice'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id, notice_id }: { endpoint_id: string; group_id: number; notice_id: string }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.deleteGroupNotice(group_id, notice_id);
      return { success: true };
  },
});
