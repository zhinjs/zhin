import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{
  channel_id: string;
  purpose: string;
}>({
  description: '设置 Slack 频道的用途/目的',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    purpose: z.string().describe('频道用途描述'),
  }),
  adapter: 'slack',
  scopes: ["group"],
  tags: ['slack'],
  permissions: [platformPermission('slack', 'channel_manager')],
  async execute({ channel_id, purpose }, context) {
    const client = context.$client;
    await client.conversations.setPurpose({ channel: channel_id, purpose });
    const success = true;
    return { success, message: success ? t(context.locale, 'purposeUpdated') : t(context.locale, 'operationFailed') };
  },
});
