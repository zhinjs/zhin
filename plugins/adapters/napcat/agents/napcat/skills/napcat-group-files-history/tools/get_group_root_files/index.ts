import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前群的根目录文件列表。',
  inputSchema: z.object({}),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群文件列表', 'group files'],
  scopes: ['group'],
  async execute(_input, context) {
    return context.$client.getGroupRootFiles(currentGroup(context));
  },
});
