import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubWhoami } from '../../src/github-tool-handlers.js';

export default defineAgentTool<{}>({
  description: '查看你绑定的 GitHub 账号信息',
  adapter: 'github',
  inputSchema: z.object({}),
  tags: ['github'],
  async execute(input, context) {
    return executeGithubWhoami({}, context.$client, context.message);
  },
});
