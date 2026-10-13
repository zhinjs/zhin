import { defineCommand } from 'zhin.js/command';
import { raw } from '@zhin.js/core/runtime';
import { buildQrImageUrl } from '../../src/qrcode-lib.js';

export default defineCommand({
  description: '根据文本或链接生成二维码图片',
  params: { text: { type: 'text', min: 1, max: 2048, description: '二维码内容（可含空格）' } },
  options: { size: { type: 'integer', alias: 's', default: 300, min: 64, max: 1024, description: '图片宽高（像素）' } },
  execute: ({ params, options }) => raw({ type: 'image', data: { url: buildQrImageUrl(params.text, options.size) } }),
});
