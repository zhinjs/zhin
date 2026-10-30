import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';

export default defineAgentTool({
  description: '获取当前 QQ 群的基本信息（群名、简介、分类、标签、人数）',
  adapter: 'qq',
  scopes: ['group'],
  requiresApproval: 'never',
  readOnly: true,
  inputSchema: z.object({}),
  async execute(_input, context) {
    const info = await context.$client.api.groupService.getInfo(currentGroup(context));
    return { success: true, group: info };
  },
});
