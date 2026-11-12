import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ file: string; name: string; folder?: string }>({
  description: '上传文件到当前群。file 为宿主机本地路径或 URL（读取宿主文件，仅全局主人可用）。',
  inputSchema: z.object({
    file: z.string().describe('文件路径或 URL'),
    name: z.string().describe('文件名'),
    folder: z.string().optional().describe('目标文件夹 ID（可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['上传文件', 'upload file', '群文件'],
  scopes: ['group'],
  // `file` may be a path on the host: reading host files is a host-global capability (ADR 0056 §2).
  permissions: ['owner@global'],
  async execute({ file, name, folder }, context) {
    await context.$client.uploadGroupFile({ groupId: currentGroup(context), file, name, folder });
    return { success: true };
  },
});
