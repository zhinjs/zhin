import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDiscordAgentDeps } from '../../src/discord-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; channel_id: string; message_id: string; emoji: string }>({
  description: '对 Discord 消息添加表情反应',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('频道 ID'),
    message_id: z.string().describe('消息 ID'),
    emoji: z.string().describe('表情（Unicode 表情或自定义表情如 <:name:id>）'),
  }),
  platforms: ['discord'],
  tags: ['discord'],
  async execute({ endpoint_id, channel_id, message_id, emoji  }: { endpoint_id: string; channel_id: string; message_id: string; emoji: string }) {
    const endpoint = getDiscordAgentDeps().getGatewayEndpoint(endpoint_id) as {
      addReaction: (channelId: string, messageId: string, reaction: string) => Promise<void>;
    };
    await endpoint.addReaction(channel_id, message_id, emoji);
    return { success: true, message: `已添加反应 ${emoji}` };
  },
});
