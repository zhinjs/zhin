import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubBind } from '../../src/github-tool-handlers.js';

export default defineTool({
  description: '绑定你的 GitHub 账号 — 使用 Device Flow 授权，无需输入密码',
  inputSchema: z.object({}),
  tags: ['github'],
  async execute() {
    return executeGithubBind({});
  },
});
