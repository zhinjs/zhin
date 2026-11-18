import { defineAgentTool } from '@zhin.js/tool';
import { sixtySClientToken } from '../../../../src/client.js';
import { z } from 'zod';

export default defineAgentTool({
  description: "获取摸鱼日历，查看今天适不适合摸鱼",
  inputSchema: z.object({}),
  keywords: ["摸鱼", "摸鱼日历", "moyu"],
  readOnly: true,
  // ADR 0067 D1.2: festival names and countdown labels are upstream free text, not trusted output.
  tags: ["生活", "摸鱼", "日历", "external_content"],
  async execute(_input, context) {
    const handler = (await import('../../../../src/handlers/moyu.js')).default;
    return handler(context.use(sixtySClientToken), context.locale);
  },
});
