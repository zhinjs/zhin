import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLarkAgentDeps } from '../../src/lark-agent-deps.js';

export default defineTool<{ endpoint_id: string; user_id: string }>({
  description: '获取飞书用户信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.string().describe('用户 ID (open_id)'),
  }),
  platforms: ['lark'],
  tags: ['lark'],
  async execute({ endpoint_id, user_id   }: { endpoint_id: string; user_id: string }) {
    const endpoint = getLarkAgentDeps().getEndpoint(endpoint_id);
    return await endpoint.getUserInfo(user_id);
  },
});

