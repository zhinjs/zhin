import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubSubscriptions } from '../../src/github-tool-handlers.js';

export default defineAgentTool<{}>({
  description: '查看当前聊天通道的 GitHub 仓库订阅列表',
  inputSchema: z.object({}),
  adapter: 'github',
  tags: ['github'],
  async execute(input, context) {
    return executeGithubSubscriptions({}, context.$client, context.message);
  },
});
