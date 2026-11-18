import { defineAgentTool } from '@zhin.js/tool';
import { sixtySClientToken } from '../../../../src/client.js';
import { z } from 'zod';

export default defineAgentTool({
  description: "查询今日黄金价格",
  inputSchema: z.object({}),
  keywords: ["金价", "黄金", "黄金价格", "gold"],
  readOnly: true,
  // ADR 0067 D1.2: metal names and units are spliced from upstream as is, not trusted output.
  tags: ["金融", "黄金", "价格", "external_content"],
  async execute(_input, context) {
    const handler = (await import('../../../../src/handlers/gold-price.js')).default;
    return handler(context.use(sixtySClientToken), context.locale);
  },
});
