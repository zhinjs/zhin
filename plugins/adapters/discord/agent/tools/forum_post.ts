import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '../../src/client.js';
import { ChannelType } from 'discord.js';

export default defineAgentTool<{ channel_id: string; name: string; content: string; tags?: string }>({
  description: '在 Discord 论坛频道中创建帖子',
  inputSchema: z.object({
    channel_id: z.string().describe('论坛频道 ID'),
    name: z.string().describe('帖子标题'),
    content: z.string().describe('帖子内容'),
    tags: z.string().optional().describe('标签名，逗号分隔（可选）'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  async execute({ channel_id, name, content, tags  }: { channel_id: string; name: string; content: string; tags?: string }, context) {
    const client = requireDiscordGatewayClient(context.$client);
    const tagList = tags ? tags.split(',').map((t: string) => t.trim()) : undefined;
    const channel = await client.channels.fetch(channel_id);
    if (!channel?.threads || channel.type !== ChannelType.GuildForum) {
      throw new Error(`Channel ${channel_id} 不是论坛频道`);
    }
    const tagIds = tagList?.length
      ? channel.availableTags?.filter((tag) => tagList.includes(tag.name)).map((tag) => tag.id)
      : undefined;
    const thread = await channel.threads.create({
      name,
      message: { content },
      ...(tagIds?.length ? { appliedTags: tagIds } : {}),
    });
    return { success: true, thread_id: thread.id, message: `论坛帖 "${name}" 已创建` };
  },
});
