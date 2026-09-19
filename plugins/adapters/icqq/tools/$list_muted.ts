import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number }>({
  description: '查询 QQ 群中当前被禁言的成员列表',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
  }),
  adapter: 'icqq',
  permissions: ['role(master,admin)'],
  async execute({ group_id }, context) {
    const members = await context.$client.getGroupMemberList(group_id);
    const now = Math.floor(Date.now() / 1000);
    const muted = Array.from(members.values()).filter((m) => m.shutup_time > now);
    return { muted_members: muted, count: muted.length };
  },
});
