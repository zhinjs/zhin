import { defineCommand } from 'zhin.js/command';
import { raw } from '@zhin.js/core/runtime';
import { buildQrImageUrl } from '../../src/qrcode-lib.js';

export default defineCommand({
  description: '根据文本或链接生成二维码图片', descriptionI18n: { en: "Generate a QR code image from text or a link" },
  params: { text: { type: 'text', min: 1, max: 2048, description: '二维码内容（可含空格）', descriptionI18n: { en: "QR code content (spaces allowed)" } } },
  options: { size: { type: 'integer', alias: 's', default: 300, min: 64, max: 1024, description: '图片宽高（像素）', descriptionI18n: { en: "Image width and height in pixels" } } },
  execute: ({ params, options }) => raw({ type: 'image', data: { url: buildQrImageUrl(params.text, options.size) } }),
});
