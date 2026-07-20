import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool({
  description: "获取 Bing 每日壁纸图片",
  inputSchema: z.object({}),
  keywords: ["bing", "必应", "壁纸", "每日壁纸"],
  tags: ["图片", "壁纸", "Bing"],
  async execute() {
    const handler = (await import('../../src/handlers/bing-image.js')).default;
    return handler();
  },
});
