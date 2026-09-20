import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { executeGithubPushBranch } from '../../handlers.js';

export default defineAgentTool<{ repo?: string; branch?: string; message: string }>({
  description: '在托管工作区 git commit 并 push 到远程分支（需 HITL 确认；Bot 身份）',
  adapter: 'github',
  inputSchema: z.object({
    repo: z.string().optional().describe('owner/repo'),
    branch: z.string().optional().describe('分支名，缺省从上下文推断'),
    message: z.string().describe('commit message'),
  }),
  tags: ['github'],
  requiresApproval: 'always',
  async execute(input, context) {
    return executeGithubPushBranch(input, context.$client);
  },
});
