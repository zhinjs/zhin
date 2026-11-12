import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前群的公告列表。',
  inputSchema: z.object({}),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群公告', '获取公告', 'get notice'],
  scopes: ['group'],
  async execute(_input, context) {
    return context.$client.getGroupNotice(currentGroup(context));
  },
});
