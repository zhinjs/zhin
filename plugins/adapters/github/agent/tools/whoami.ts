import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubWhoami } from '../../src/github-tool-handlers.js';

export default defineAgentTool({
  description: '查看你绑定的 GitHub 账号信息',
  inputSchema: z.object({}),
  tags: ['github'],
  async execute() {
    return executeGithubWhoami({});
  },
});
