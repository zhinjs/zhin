import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取 QQ 频道列表',
  inputSchema: z.object({}),
  adapter: 'qq',
  tags: ['qq'],
  async execute(_input, context) {
    const client = context.$client;
    const guilds = await client.guildService.getList();
    return { guilds, count: guilds.length };
  },
});
