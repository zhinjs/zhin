import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number; duration?: number }>({
  description: '禁言/解除禁言指定成员',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    duration: z.number().describe('禁言时间(秒)，0=解除禁言').default(0),
  }),
  adapter: 'icqq',
  scopes:['group'],
  requiresApproval: 'always',
  async execute({ group_id, user_id, duration }, context) {
    const client = context.$client;
    const selfInfo= client.pickMember(group_id,client.uin);
    if(!selfInfo.is_admin && !selfInfo.is_owner) return { success: false, message: t(context.locale, 'muteForbidden') };
    const memberInfo= client.pickMember(group_id,user_id);
    if(!memberInfo) return { success: false, message: t(context.locale, 'memberMissing') };
    await client.setGroupBan(group_id, user_id, duration === 0 ? 0 : duration);
    return { success: true, message: duration === 0 ? t(context.locale, 'unmuted', { user: user_id }) : t(context.locale, 'muted', { user: user_id, seconds: duration ?? 0 }) };
  },
});
