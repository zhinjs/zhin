import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ image: string }>({
  description: '图片 OCR 文字识别。',
  inputSchema: z.object({
    image: z.string().describe('图片 file 参数（收到消息中的 file 字段或 URL）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['OCR', '文字识别', '图片识别', 'ocr'],
  async execute({ image }: { image: string }, context) {
    const endpoint = context.$client;
      return endpoint.ocrImage(image);
  },
});
