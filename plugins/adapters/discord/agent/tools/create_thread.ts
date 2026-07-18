import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getDiscordAgentDeps } from '../../src/discord-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; channel_id: string; name: string; message_id?: string; auto_archive_duration?: number }>({
  description: '在 Discord 频道中创建帖子/子线程',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('频道 ID'),
    name: z.string().describe('帖子标题'),
    message_id: z.string().optional().describe('基于某条消息创建（可选）'),
    auto_archive_duration: z.number().optional().describe('自动归档时间（分钟：60/1440/4320/10080）'),
  }),
  platforms: ['discord'],
  tags: ['discord'],
  permissions: [platformPermit('manage_channels')],
  async execute({ endpoint_id, channel_id, name, message_id, auto_archive_duration  }: { endpoint_id: string; channel_id: string; name: string; message_id?: string; auto_archive_duration?: number }) {
    const endpoint = getDiscordAgentDeps().getGatewayEndpoint(endpoint_id) as {
      createThread: (channelId: string, threadName: string, messageId?: string, autoArchiveDuration?: number) => Promise<{ id: string }>;
    };
    const thread = await endpoint.createThread(channel_id, name, message_id, auto_archive_duration);
    return { success: true, thread_id: thread.id, message: `帖子 "${name}" 已创建` };
  },
});
