import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../src/icqq-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string }>({
  description: '获取 QQ 好友列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
  }),
  platforms: ['icqq'],
  approval: 'never',
  async execute({ endpoint_id }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const friends = Array.from(endpoint.fl.values()).map((friend) => ({
      user_id: friend.user_id,
      nickname: friend.nickname,
      remark: friend.remark,
    }));
    return { friends: friends.slice(0, 50), count: endpoint.fl.size };
  },
});
