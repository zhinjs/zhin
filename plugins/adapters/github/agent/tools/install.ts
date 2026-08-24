import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubInstall } from '../../src/github-tool-handlers.js';

export default defineAgentTool<{}>({
  description: '获取安装 GitHub App 的链接 — 安装后 Endpoint 可以访问你的仓库，你也可以使用更多功能',
  adapter: 'github',
  inputSchema: z.object({}),
  tags: ['github'],
  async execute(input, context) {
    return executeGithubInstall(context.$client);
  },
});
