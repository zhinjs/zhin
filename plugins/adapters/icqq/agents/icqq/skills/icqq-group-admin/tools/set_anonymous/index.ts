import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; enable?: boolean }>({
  description: '开启或关闭 QQ 群的匿名聊天功能',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    enable: z.boolean().optional().describe('true=开启，false=关闭，默认 true'),
  }),
  adapter: 'icqq',
  requiresApproval: 'once',
  scopes:['group'],
  permissions: ['role(master,trusted,owner,admin)'],
  async execute({ group_id, enable }, context) {
    const client = context.$client;
    const on = enable ?? true;
    const selfInfo= client.pickMember(group_id,client.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: t(context.locale, 'anonymousForbidden') };
    await client.setGroupAnonymous(group_id, on);
    return { success: true, message: on ? t(context.locale, 'anonymousEnabled') : t(context.locale, 'anonymousDisabled') };
  },
});
