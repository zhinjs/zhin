import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; enable?: boolean }>({
  description: '开启或关闭 QQ 群的匿名聊天功能',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    enable: z.boolean().optional().describe('true=开启，false=关闭，默认 true'),
  }),
  adapter: 'icqq',
  permissions: ['role(master,trusted,owner,admin)'],
  async execute({ group_id, enable }, context) {
    const client = context.$client;
    const on = enable ?? true;
    const selfInfo= client.pickMember(group_id,client.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: '我不是群主或管理员，无法开启或关闭匿名聊天' };
    await client.setGroupAnonymous(group_id, on);
    return { success: true, message: on ? '已开启匿名聊天' : '已关闭匿名聊天' };
  },
});
