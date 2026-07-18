import { defineCommand } from '@zhin.js/command';
import { raw } from '@zhin.js/core/runtime';
import { buildQrImageUrl } from '../src/qrcode-lib.js';

export default defineCommand({
  description: '根据文本或链接生成二维码图片',
  execute: ({ params }) => raw({
    type: 'image',
    data: { url: buildQrImageUrl(String(params.text)) },
  }),
});
