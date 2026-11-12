import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  channel: string;
}>({
  description: '归档 Slack 频道',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
  }),
  adapter: 'slack',
  scopes: ["group"],
  tags: ['slack'],
  permissions: ['platform-permission:workspace_admin'],
  async execute({ channel }, context) {
    const client = context.$client;
    await client.conversations.archive({ channel });
    const success = true;
    return { success, message: success ? t(context.locale, 'channelArchived') : t(context.locale, 'operationFailed') };
  },
});
