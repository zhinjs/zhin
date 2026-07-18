import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubPrepareWorkspace } from '../../src/github-bot-handlers.js';

export default defineAgentTool<{ repo?: string }>({
  description: 'Clone/fetch 托管工作区并 checkout 到 Issue/PR 对应分支（GitHub App Bot 身份）',
  inputSchema: z.object({
    repo: z.string().optional().describe('owner/repo，缺省从当前 Issue/PR 频道推断'),
  }),
  tags: ['github'],
  async execute(input) {
    return executeGithubPrepareWorkspace(input);
  },
});
