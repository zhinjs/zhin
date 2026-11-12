import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ channel_id: string }>({
  description: '获取 QQ 频道中指定子频道的详细信息',
  inputSchema: z.object({
    channel_id: z.string().describe('子频道 ID'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:admin'],
  async execute({ channel_id  }: { channel_id: string }, context) {
    const client = context.$client;
    return client.channelService.getInfo(channel_id);
  },
});
