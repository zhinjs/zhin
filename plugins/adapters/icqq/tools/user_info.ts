import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; user_id: number }>({
  description: '获取指定QQ号的用户信息/资料/详情',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    user_id: z.number().describe('目标成员 QQ号'),
  }),
  platforms: ['icqq'],
  async execute({ endpoint_id, user_id }: { endpoint_id: string; user_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const profile = await endpoint.getProfile(user_id);
    return { success: true, message: `已获取 ${user_id} 的用户信息:${JSON.stringify(profile,null,2)}` };
  },
});
