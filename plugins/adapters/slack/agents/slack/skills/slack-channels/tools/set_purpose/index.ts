import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  purpose: string;
}>({
  description: '设置当前 Slack 频道的用途/目的',
  inputSchema: z.object({
    purpose: z.string().describe('频道用途描述'),
  }),
  adapter: 'slack',
  scopes: ["group"],
  tags: ['slack'],
  permissions: ['admin'],
  async execute({ purpose }, context) {
    const channel_id = currentChannel(context);
    const client = context.$client;
    await client.conversations.setPurpose({ channel: channel_id, purpose });
    const success = true;
    return { success, message: success ? t(context.locale, 'purposeUpdated') : t(context.locale, 'operationFailed') };
  },
});
