import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{ guild_id: string; channel_id: string; user_id: string; role_id: string }>({
  description: '移除成员的 QQ 频道角色',
  inputSchema: z.object({
    guild_id: z.string().describe('频道 ID'),
    channel_id: z.string().describe('子频道 ID'),
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: [platformPermission('qq', 'manage_roles')],
  async execute({ guild_id, channel_id, user_id, role_id  }: { guild_id: string; channel_id: string; user_id: string; role_id: string }, context) {
    const client = context.$client;
    await client.memberService.removeMemberRole(guild_id, channel_id, user_id, role_id);
    const success = true;
    return { success, message: success ? t(context.locale, 'roleRemoved') : t(context.locale, 'operationFailed') };
  },
});
