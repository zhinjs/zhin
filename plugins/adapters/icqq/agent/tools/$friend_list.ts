import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取 QQ 好友列表',
  inputSchema: z.object({}),
  adapter: 'icqq',
  approval: 'never',
  async execute(_input, context) {
    const client = context.$client;
    const friends = Array.from(client.fl.values()).map((friend) => ({
      user_id: friend.user_id,
      nickname: friend.nickname,
      remark: friend.remark,
    }));
    return { friends: friends.slice(0, 50), count: client.fl.size };
  },
});
