import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前群的精华消息列表。',
  inputSchema: z.object({}),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['精华列表', 'essence list'],
  scopes: ['group'],
  async execute(_input, context) {
    return context.$client.getEssenceMsgList(currentGroup(context));
  },
});
