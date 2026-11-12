import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  users: string;
}>({
  description: '邀请用户加入当前 Slack 频道',
  inputSchema: z.object({
    users: z.string().describe('用户 ID 列表（逗号分隔）'),
  }),
  adapter: 'slack',
  scopes: ["group"],
  tags: ['slack'],
  permissions: ['admin'],
  async execute({ users }, context) {
    const channel = currentChannel(context);
    const client = context.$client;
    await client.conversations.invite({ channel, users });
    const success = true;
    return { success, message: success ? t(context.locale, 'channelInvited') : t(context.locale, 'operationFailed') };
  },
});
