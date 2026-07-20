import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubStar } from '../../src/github-tool-handlers.js';

export default defineAgentTool<{ action: 'star' | 'unstar' | 'check'; repo: string }>({
  description: 'Star 或取消 Star 一个 GitHub 仓库（使用你绑定的 GitHub 账号，未绑定则用 Endpoint 默认账号）',
  inputSchema: z.object({
    action: z.enum(['star', 'unstar', 'check']),
    repo: z.string().min(1),
  }),
  tags: ['github'],
  async execute(input) {
    return executeGithubStar(input);
  },
});
