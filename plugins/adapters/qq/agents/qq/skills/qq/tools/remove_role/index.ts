import { messages as t } from "../../../../messages.js";
import { currentGuildChannel } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ user_id: string; role_id: string }>({
  description: '移除当前 QQ 频道中成员的身份组',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:admin', 'bot:admin'],
  async execute({ user_id, role_id }, context) {
    const { guildId: guild_id, channelId: channel_id } = currentGuildChannel(context);
    const client = context.$client;
    await client.memberService.removeMemberRole(guild_id, channel_id, user_id, role_id);
    const success = true;
    return { success, message: success ? t(context.locale, 'roleRemoved') : t(context.locale, 'operationFailed') };
  },
});
