import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { executeGithubWhoami } from '../../src/github-tool-handlers.js';

export default defineTool({
  description: '查看你绑定的 GitHub 账号信息',
  inputSchema: z.object({}),
  tags: ['github'],
  async execute() {
    return executeGithubWhoami({});
  },
});
