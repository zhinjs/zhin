import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前群的禁言列表。',
  inputSchema: z.object({}),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['禁言列表', 'shut list', '被禁言'],
  scopes: ['group'],
  async execute(_input, context) {
    return context.$client.getGroupShutList(currentGroup(context));
  },
});
