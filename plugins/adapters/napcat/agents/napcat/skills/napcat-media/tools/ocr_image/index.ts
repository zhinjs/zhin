import { requireRemoteMedia } from "../../../../media.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ image: string }>({
  description: '图片 OCR 文字识别。',
  inputSchema: z.object({
    image: z.string().describe('图片 file 参数（收到消息中的 file 字段、http(s) 链接或 base64://；不接受本机路径）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['OCR', '文字识别', '图片识别', 'ocr'],
  async execute({ image }, context) {
    requireRemoteMedia(context, image, 'image');
    return context.$client.ocrImage(image);
  },
});
