import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前群的额外详细信息。',
  inputSchema: z.object({}),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群详情', '群额外信息', 'group info ex'],
  scopes: ['group'],
  async execute(_input, context) {
    return context.$client.getGroupInfoEx(currentGroup(context));
  },
});
