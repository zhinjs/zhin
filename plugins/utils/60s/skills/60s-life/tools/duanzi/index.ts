import { defineAgentTool } from '@zhin.js/tool';
import { sixtySClientToken } from '../../../../src/client.js';
import { z } from 'zod';

export default defineAgentTool({
  description: "获取一个段子",
  inputSchema: z.object({}),
  keywords: ["段子", "笑话", "搞笑", "joke", "duanzi"],
  tags: ["娱乐", "笑话", "段子"],
  async execute(_input, context) {
    const handler = (await import('../../../../src/handlers/duanzi.js')).default;
    return handler(context.use(sixtySClientToken));
  },
});
