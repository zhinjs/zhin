import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '../../src/client.js';

export default defineAgentTool<{ channel_id: string; title?: string; description?: string; color?: number; url?: string; fields?: string }>({
  description: '发送 Discord 富文本嵌入消息（Embed）',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    title: z.string().optional().describe('Embed 标题'),
    description: z.string().optional().describe('Embed 描述'),
    color: z.number().optional().describe('颜色值（十进制，如 0x00ff00 = 65280）'),
    url: z.string().optional().describe('标题链接（可选）'),
    fields: z.string().optional().describe('字段，JSON 格式: [{"name":"k","value":"v","inline":false}]'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  async execute({ channel_id, title, description, color, url, fields  }: { channel_id: string; title?: string; description?: string; color?: number; url?: string; fields?: string }, context) {
    const client = requireDiscordGatewayClient(context.$client);
    const embedData: Record<string, unknown> = {};
    if (title) embedData.title = title;
    if (description) embedData.description = description;
    if (color) embedData.color = color;
    if (url) embedData.url = url;
    if (fields) {
      try {
        embedData.fields = JSON.parse(fields);
      } catch {
        return { success: false, message: 'fields 格式错误，应为 JSON 数组' };
      }
    }
    const channel = await client.channels.fetch(channel_id);
    if (!channel?.isTextBased() || !channel.send) {
      throw new Error(`Channel ${channel_id} 不是文本频道`);
    }
    const msg = await channel.send({ embeds: [embedData] } as never);
    return { success: true, message_id: msg.id, message: 'Embed 已发送' };
  },
});
