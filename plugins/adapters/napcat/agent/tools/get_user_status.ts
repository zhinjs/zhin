import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; user_id: number }>({
  description: '获取用户在线状态。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.number().describe('目标 QQ 号'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['在线状态', '用户状态', 'online status'],
  async execute({ endpoint_id, user_id }: { endpoint_id: string; user_id: number }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.ncGetUserStatus(user_id);
  },
});
