import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { qrImageSegment } from '../../../../src/qrcode-lib.js';

export default defineAgentTool<{ text: string }>({
  description: '根据文本或 URL 生成二维码图片',
  inputSchema: z.object({ text: z.string().min(1) }),
  keywords: ['二维码', 'QR', 'qrcode'],
  tags: ['qrcode', 'image'],
  async execute({ text }) {
    return JSON.stringify(await qrImageSegment(text));
  },
});
