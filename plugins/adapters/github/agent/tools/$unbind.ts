import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubUnbind } from '../../src/github-tool-handlers.js';

export default defineAgentTool<{}>({
  description: '解除你绑定的 GitHub 账号',
  adapter: 'github',
  inputSchema: z.object({}),
  tags: ['github'],
  async execute(input, context) {
    return executeGithubUnbind({}, context.$client, context.message);
  },
});
