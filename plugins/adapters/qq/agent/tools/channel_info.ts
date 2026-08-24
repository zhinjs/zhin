import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ channel_id: string }>({
  description: '获取 QQ 频道中指定子频道的详细信息',
  inputSchema: z.object({
    channel_id: z.string().describe('子频道 ID'),
  }),
  adapter: 'qq',
  tags: ['qq'],
  permissions: [platformPermit('guild_admin')],
  async execute({ channel_id  }: { channel_id: string }, context) {
    const client = context.$client;
    return client.getChannelInfo(channel_id);
  },
});
