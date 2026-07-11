import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; group_id: number }>({
  description: '群签到/群打卡。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['签到', '打卡', 'sign', 'check in'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id }: { endpoint_id: string; group_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      await endpoint.sendGroupSign(group_id);
      return { success: true };
  },
});
