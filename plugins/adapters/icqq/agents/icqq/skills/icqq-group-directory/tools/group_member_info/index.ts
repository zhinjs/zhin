import { messages as t } from "../../../../messages.js";
import { freshMember } from "../../../../members.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
interface GroupMemberInfoInput {
  group_id: number;
  user_id: number;
}

export default defineAgentTool<GroupMemberInfoInput>({
  description: '获取 QQ 群成员信息',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
  }),
  adapter: 'icqq',
  scopes:['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'never',
  async execute({ group_id, user_id }, context) {
    // pickMember 返回的是实体对象，序列化后只剩 `{}`：模型会据此以为成员不在群里。按 group_kick 的口径实时查询。
    const info = await freshMember(context.$client, group_id, user_id);
    if (!info) return { success: false, message: t(context.locale, 'memberMissing') };
    return {
      success: true,
      member: {
        group_id: info.group_id,
        user_id: info.user_id,
        nickname: info.nickname,
        card: info.card,
        role: info.role,
        title: info.title,
        level: info.level,
        join_time: info.join_time,
        last_sent_time: info.last_sent_time,
        shutup_time: info.shutup_time,
      },
    };
  },
});
