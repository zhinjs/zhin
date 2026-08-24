import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '../../src/client.js';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ channel_id: string; name: string; message_id?: string; auto_archive_duration?: number }>({
  description: '在 Discord 频道中创建帖子/子线程',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    name: z.string().describe('帖子标题'),
    message_id: z.string().optional().describe('基于某条消息创建（可选）'),
    auto_archive_duration: z.number().optional().describe('自动归档时间（分钟：60/1440/4320/10080）'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  permissions: [platformPermit('manage_channels')],
  async execute({ channel_id, name, message_id, auto_archive_duration  }: { channel_id: string; name: string; message_id?: string; auto_archive_duration?: number }, context) {
    const client = requireDiscordGatewayClient(context.$client);
    const channel = await client.channels.fetch(channel_id);
    if (!channel?.threads) throw new Error(`Channel ${channel_id} 不支持创建帖子`);
    const thread = await channel.threads.create({
      name,
      autoArchiveDuration: auto_archive_duration || 1440,
      ...(message_id ? { startMessage: message_id } : {}),
    });
    return { success: true, thread_id: thread.id, message: `帖子 "${name}" 已创建` };
  },
});
