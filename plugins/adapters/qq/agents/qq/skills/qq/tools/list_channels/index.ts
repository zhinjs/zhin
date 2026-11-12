import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ guild_id: string }>({
  description: '获取 QQ 频道下的子频道列表',
  inputSchema: z.object({
    guild_id: z.string().describe('频道 ID'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform-permission:manage_channels'],
  async execute({ guild_id  }: { guild_id: string }, context) {
    const client = context.$client;
    const channels = await client.channelService.getList(guild_id);
    return { channels, count: channels.length };
  },
});
