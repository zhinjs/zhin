import { currentGuildChannel } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ user_id: string }>({
  description: '获取当前 QQ 频道中指定成员的详细信息',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:admin'],
  async execute({ user_id }, context) {
    const { guildId: guild_id } = currentGuildChannel(context);
    const client = context.$client;
    return client.memberService.getGuildMemberInfo(guild_id, user_id);
  },
});
