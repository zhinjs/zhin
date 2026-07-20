import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getWecomAgentDeps } from '../../src/wecom-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; user_id: string }>({
  description: '获取企业微信用户信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.string().describe('用户 ID'),
  }),
  platforms: ['wecom'],
  tags: ['wecom'],
  async execute({ endpoint_id, user_id    }: { endpoint_id: string; user_id: string }) {
    const endpoint = getWecomAgentDeps().getEndpoint(endpoint_id);
    return await endpoint.getUserInfo(user_id);
  },
});

