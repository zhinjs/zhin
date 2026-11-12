import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '在当前群签到/打卡。',
  inputSchema: z.object({}),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['签到', '打卡', 'sign', 'check in'],
  scopes: ['group'],
  async execute(_input, context) {
    await context.$client.sendGroupSign(currentGroup(context));
    return { success: true };
  },
});
