import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubSubscribe } from '../../src/github-tool-handlers.js';

export default defineAgentTool<{ repo: string; events?: string }>({
  description: '订阅 GitHub 仓库的 Webhook 事件，事件将推送到当前聊天通道',
  inputSchema: z.object({
    repo: z.string().min(1),
    events: z.string().optional(),
  }),
  platforms: ['github'],
  tags: ['github'],
  async execute(input) {
    return executeGithubSubscribe(input);
  },
});
