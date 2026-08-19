import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string; group_id: number; user_id: number }>({
  description: '在 QQ 群中对某个成员执行戳一戳互动操作',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint QQ号'),
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要戳的目标成员 QQ号'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id, group_id, user_id }: { endpoint_id: string; group_id: number; user_id: number }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    await endpoint.sendGroupPoke(group_id, user_id);
    return { success: true, message: `已戳了戳 ${user_id}` };
  },
});
