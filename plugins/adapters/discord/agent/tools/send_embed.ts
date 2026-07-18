import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDiscordAgentDeps } from '../../src/discord-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; channel_id: string; title?: string; description?: string; color?: number; url?: string; fields?: string }>({
  description: '发送 Discord 富文本嵌入消息（Embed）',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('频道 ID'),
    title: z.string().optional().describe('Embed 标题'),
    description: z.string().optional().describe('Embed 描述'),
    color: z.number().optional().describe('颜色值（十进制，如 0x00ff00 = 65280）'),
    url: z.string().optional().describe('标题链接（可选）'),
    fields: z.string().optional().describe('字段，JSON 格式: [{"name":"k","value":"v","inline":false}]'),
  }),
  platforms: ['discord'],
  tags: ['discord'],
  async execute({ endpoint_id, channel_id, title, description, color, url, fields  }: { endpoint_id: string; channel_id: string; title?: string; description?: string; color?: number; url?: string; fields?: string }) {
    const endpoint = getDiscordAgentDeps().getGatewayEndpoint(endpoint_id) as {
      sendEmbed: (channelId: string, embed: Record<string, unknown>) => Promise<{ id: string }>;
    };
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
    const msg = await endpoint.sendEmbed(channel_id, embedData);
    return { success: true, message_id: msg.id, message: 'Embed 已发送' };
  },
});
