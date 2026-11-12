import { currentGuildChannel } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ channel_id?: string }>({
  description: '获取当前 QQ 频道中某个子频道的详细信息（缺省为当前子频道）',
  inputSchema: z.object({
    channel_id: z.string().optional().describe('当前频道内的子频道 ID（缺省为当前子频道）'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:admin'],
  async execute({ channel_id }, context) {
    const current = currentGuildChannel(context);
    const info = await context.$client.channelService.getInfo(channel_id || current.channelId);
    // Platform permits vouch for the current guild only: never describe another guild's channel.
    if (String((info as { guild_id?: unknown } | undefined)?.guild_id ?? '') !== current.guildId) {
      throw new Error(t(context.locale, 'channelRequired'));
    }
    return info;
  },
});
