import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineAgentTool<{ endpoint_id: string }>({
  description: '获取 QQ 好友列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  async execute({ endpoint_id    }: { endpoint_id: string }) {
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const friends = Array.from(endpoint.friends.values()).map((f) => ({
      user_id: f.user_id, nickname: f.nickname, remark: f.remark,
    }));
    return { friends: friends.slice(0, 50), count: endpoint.friends.size };
  },
});

