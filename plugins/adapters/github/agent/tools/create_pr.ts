import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubCreatePr } from '../../src/github-bot-handlers.js';

export default defineAgentTool<{ repo?: string; title: string; body?: string; head?: string; base?: string }>({
  description: '以 GitHub App Bot 身份创建 Pull Request（需 HITL 确认；Issue 场景常用）',
  inputSchema: z.object({
    repo: z.string().optional().describe('owner/repo'),
    title: z.string().describe('PR 标题'),
    body: z.string().optional().describe('PR 正文'),
    head: z.string().optional().describe('head 分支，缺省为工作区分支'),
    base: z.string().optional().describe('base 分支，缺省为仓库默认分支'),
  }),
  tags: ['github'],
  approval: 'always',
  async execute(input) {
    return executeGithubCreatePr(input);
  },
});
