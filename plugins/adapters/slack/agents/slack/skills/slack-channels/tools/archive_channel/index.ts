import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '归档当前 Slack 频道（仅 zhin owner）',
  inputSchema: z.object({}),
  adapter: 'slack',
  scopes: ["group"],
  tags: ['slack'],
  permissions: ['owner'],
  async execute(_args, context) {
    const channel = currentChannel(context);
    const client = context.$client;
    await client.conversations.archive({ channel });
    const success = true;
    return { success, message: success ? t(context.locale, 'channelArchived') : t(context.locale, 'operationFailed') };
  },
});
