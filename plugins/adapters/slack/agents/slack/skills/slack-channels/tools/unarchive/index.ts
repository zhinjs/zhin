import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  channel_id: string;
}>({
  description: '恢复已归档的 Slack 频道（归档频道无法在其中对话，需指定频道 ID；仅 zhin owner）',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
  }),
  adapter: 'slack',
  scopes: ["group"],
  tags: ['slack'],
  permissions: ['owner'],
  async execute({ channel_id }, context) {
    const client = context.$client;
    await client.conversations.unarchive({ channel: channel_id });
    const success = true;
    return { success, message: success ? t(context.locale, 'channelRestored') : t(context.locale, 'operationFailed') };
  },
});
