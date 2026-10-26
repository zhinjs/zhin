import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '@zhin.js/adapter-discord';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{ channel_id: string; name: string; message_id?: string; auto_archive_duration?: number }>({
  description: '在 Discord 频道中创建帖子/子线程',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    name: z.string().describe('帖子标题'),
    message_id: z.string().optional().describe('基于某条消息创建（可选）'),
    auto_archive_duration: z.number().optional().describe('自动归档时间（分钟：60/1440/4320/10080）'),
  }),
  adapter: 'discord',
  scopes: ["channel"],
  tags: ['discord'],
  permissions: [platformPermission('discord', 'manage_channels')],
  async execute({ channel_id, name, message_id, auto_archive_duration  }: { channel_id: string; name: string; message_id?: string; auto_archive_duration?: number }, context) {
    const client = requireDiscordGatewayClient(context.$client);
    const channel = await client.channels.fetch(channel_id);
    if (!channel?.threads) throw new Error(t(context.locale, 'threadsUnsupported', { p0: channel_id }));
    const thread = await channel.threads.create({
      name,
      autoArchiveDuration: auto_archive_duration || 1440,
      ...(message_id ? { startMessage: message_id } : {}),
    });
    return { success: true, thread_id: thread.id, message: t(context.locale, 'threadCreated', { p0: name }) };
  },
});
