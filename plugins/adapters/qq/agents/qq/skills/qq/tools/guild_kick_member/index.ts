import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';
import { currentGuildChannel } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '把成员移出当前 QQ 频道，可选拉黑与撤回其近期消息；每次人工审批',
  adapter: 'qq',
  scopes: ['channel'],
  tags: ['qq'],
  permissions: [platformPermission('qq', 'guild_admin')],
  requiresApproval: 'human',
  risk: 'dangerous',
  riskCategory: 'member',
  inputSchema: z.object({
    user_id: z.string().min(1).describe('要移出的成员用户 ID'),
    reason: z.string().min(1).describe('本次移出的具体原因，供人工确认'),
    blacklist: z.boolean().default(false).describe('是否同时拉黑'),
    delete_history_days: z.union([z.literal(-1), z.literal(0), z.literal(3), z.literal(7), z.literal(15), z.literal(30)])
      .default(0).describe('撤回该成员近 N 天消息：0 不撤回，-1 全部'),
  }),
  async execute({ user_id, blacklist, delete_history_days }, context) {
    const { guildId } = currentGuildChannel(context);
    const ok = await context.$client.api.memberService.kickMember(guildId, user_id, delete_history_days ?? 0, blacklist === true);
    if (ok === false) return { success: false, message: t(context.locale, 'operationFailed') };
    return { success: true, message: t(context.locale, 'memberKicked', { p0: user_id }) };
  },
});
