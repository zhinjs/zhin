import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  adapter: 'icqq',
  description: '获取当前 QQ 账号的群列表',
  inputSchema: z.object({}),
  approval: 'never',
  async execute(_input, context) {
    const client = context.$client;
    const groups = Array.from(client.gl.values()).map((group) => ({
      group_id: group.group_id,
      group_name: group.group_name,
      member_count: group.member_count,
      max_member_count: group.max_member_count,
    }));
    return { groups: groups.slice(0, 50), count: client.gl.size };
  },
});
