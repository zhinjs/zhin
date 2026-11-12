import { messages as t } from "../../../../messages.js";
import { currentGuildChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '@zhin.js/adapter-discord';
import { ThreadAutoArchiveDuration } from 'discord.js';

export default defineAgentTool<{ name: string; message_id?: string; auto_archive_duration?: number }>({
  description: '在当前 Discord 频道中创建帖子/子线程',
  inputSchema: z.object({
    name: z.string().describe('帖子标题'),
    message_id: z.string().optional().describe('基于某条消息创建（可选）'),
    auto_archive_duration: z.number().optional().describe('自动归档时间（分钟：60/1440/4320/10080）'),
  }),
  adapter: 'discord',
  scopes: ["channel"],
  tags: ['discord'],
  permissions: ['platform-permission:manage_channels', 'bot-permission:create_public_threads'],
  async execute({ name, message_id, auto_archive_duration }, context) {
    const { channelId: channel_id } = currentGuildChannel(context);
    const client = requireDiscordGatewayClient(context.$client);
    const channel = await client.channels.fetch(channel_id);
    if (!channel || !('threads' in channel) || channel.isThreadOnly()) throw new Error(t(context.locale, 'threadsUnsupported', { p0: channel_id }));
    const duration = auto_archive_duration || 1440;
    if (!Object.values(ThreadAutoArchiveDuration).includes(duration)) throw new Error('Unsupported Discord thread auto archive duration');
    const thread = await channel.threads.create({
      name,
      autoArchiveDuration: duration,
      ...(message_id ? { startMessage: message_id } : {}),
    });
    return { success: true, thread_id: thread.id, message: t(context.locale, 'threadCreated', { p0: name }) };
  },
});
