import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; group_id: number }>({
  description: '获取群精华消息列表。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['精华列表', 'essence list'],
  scopes: ['group'],
  async execute({ endpoint_id, group_id }: { endpoint_id: string; group_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.getEssenceMsgList(group_id);
  },
});
