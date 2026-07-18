import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getDiscordAgentDeps } from '../../src/discord-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; channel_id: string; name: string; content: string; tags?: string }>({
  description: '在 Discord 论坛频道中创建帖子',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('论坛频道 ID'),
    name: z.string().describe('帖子标题'),
    content: z.string().describe('帖子内容'),
    tags: z.string().optional().describe('标签名，逗号分隔（可选）'),
  }),
  platforms: ['discord'],
  tags: ['discord'],
  async execute({ endpoint_id, channel_id, name, content, tags  }: { endpoint_id: string; channel_id: string; name: string; content: string; tags?: string }) {
    const endpoint = getDiscordAgentDeps().getGatewayEndpoint(endpoint_id) as {
      createForumPost: (channelId: string, title: string, body: string, tagNames?: string[]) => Promise<{ id: string }>;
    };
    const tagList = tags ? tags.split(',').map((t: string) => t.trim()) : undefined;
    const thread = await endpoint.createForumPost(channel_id, name, content, tagList);
    return { success: true, thread_id: thread.id, message: `论坛帖 "${name}" 已创建` };
  },
});
