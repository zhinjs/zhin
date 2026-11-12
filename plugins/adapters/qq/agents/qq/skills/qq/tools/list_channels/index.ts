import { currentGuildChannel } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前 QQ 频道下的子频道列表',
  inputSchema: z.object({}),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:admin'],
  async execute(_args, context) {
    const { guildId: guild_id } = currentGuildChannel(context);
    const client = context.$client;
    const channels = await client.channelService.getList(guild_id);
    return { channels, count: channels.length };
  },
});
