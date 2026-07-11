import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineTool<{ endpoint_id: string; image: string }>({
  description: '图片 OCR 文字识别。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    image: z.string().describe('图片 file 参数（收到消息中的 file 字段或 URL）'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['OCR', '文字识别', '图片识别', 'ocr'],
  async execute({ endpoint_id, image }: { endpoint_id: string; image: string }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.ocrImage(image);
  },
});
