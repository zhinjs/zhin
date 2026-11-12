import { currentGroup } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ file: string }>({
  description: '设置当前群的群头像。file 为图片 URL、base64 或宿主本地路径（读取宿主文件，仅全局主人可用）。',
  inputSchema: z.object({
    file: z.string().describe('图片（URL 或 base64）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群头像', 'group portrait', '设置群头像'],
  // `file` may be a host path (OneBot reads `file://`): reading host files is host-global (ADR 0056 §2).
  permissions: ['owner@global', 'bot:admin'],
  scopes: ['group'],
  async execute({ file }, context) {
    const endpoint = context.$client;
      await endpoint.setGroupPortrait(currentGroup(context), file);
      return { success: true };
  },
});
