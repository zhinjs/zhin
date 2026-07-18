import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDingtalkAgentDeps } from '../../src/dingtalk-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; user_id: string }>({
  description: '获取钉钉用户信息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    user_id: z.string().describe('用户 ID'),
  }),
  platforms: ['dingtalk'],
  tags: ['dingtalk'],
  async execute({ endpoint_id, user_id    }: { endpoint_id: string; user_id: string }) {
    const endpoint = getDingtalkAgentDeps().getEndpoint(endpoint_id);
    return await endpoint.getUserInfo(user_id);
  },
});

