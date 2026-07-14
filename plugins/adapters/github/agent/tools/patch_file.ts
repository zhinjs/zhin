import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubPatchFile } from '../../src/github-bot-handlers.js';

export default defineTool<{ repo?: string; path: string; content: string; message: string; branch?: string }>({
  description: '通过 Contents API 单文件更新（小改；Bot Installation Token 身份）',
  inputSchema: z.object({
    repo: z.string().optional().describe('owner/repo'),
    path: z.string().describe('仓库内文件路径'),
    content: z.string().describe('新文件内容'),
    message: z.string().describe('commit message'),
    branch: z.string().optional().describe('目标分支，缺省从 Issue/PR 上下文推断'),
  }),
  tags: ['github'],
  async execute(input) {
    return executeGithubPatchFile(input);
  },
});
