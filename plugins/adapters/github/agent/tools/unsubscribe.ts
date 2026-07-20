import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubUnsubscribe } from '../../src/github-tool-handlers.js';

export default defineAgentTool<{ repo: string }>({
  description: '取消订阅 GitHub 仓库的 Webhook 事件',
  inputSchema: z.object({
    repo: z.string().min(1),
  }),
  platforms: ['github'],
  tags: ['github'],
  async execute(input) {
    return executeGithubUnsubscribe(input);
  },
});
