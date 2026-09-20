import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { executeGithubBind } from '../../handlers.js';

export default defineAgentTool<{}>({
  description: '绑定你的 GitHub 账号 — 使用 Device Flow 授权，无需输入密码',
  adapter: 'github',
  inputSchema: z.object({}),
  tags: ['github'],
  async execute(input, context) {
    return executeGithubBind({}, context.$client);
  },
});
