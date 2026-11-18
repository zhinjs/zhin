import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';

export default defineAgentTool({
  description: '获取当前 QQ 群的基本信息（群名、简介、分类、标签、人数）',
  adapter: 'qq',
  scopes: ['group'],
  requiresApproval: 'never',
  readOnly: true,
  // ADR 0067 D1: returns text other people can write, so it is external content, not trusted output.
  tags: ['external_content'],
  inputSchema: z.object({}),
  async execute(_input, context) {
    const info = await context.$client.groupService.getInfo(currentGroup(context));
    return { success: true, group: info };
  },
});
