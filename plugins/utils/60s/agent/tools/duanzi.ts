import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool({
  description: "获取一个段子",
  inputSchema: z.object({}),
  keywords: ["段子", "笑话", "搞笑", "joke", "duanzi"],
  tags: ["娱乐", "笑话", "段子"],
  async execute() {
    const handler = (await import('../../tools/duanzi/handler.js')).default;
    return handler();
  },
});
