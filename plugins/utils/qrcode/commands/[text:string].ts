import { defineCommand } from '@zhin.js/command';
import { raw } from '@zhin.js/core/runtime';
import { buildQrImageUrl } from '../src/qrcode-lib.js';

export default defineCommand({
  description: '根据文本或链接生成二维码图片',
  execute: ({ params, args }) => {
    // [text:string] 单动态段只消费一个词；含空格的文本需拼上剩余 args
    const text = [String(params.text ?? ''), ...args].join(' ').trim();
    return raw({
      type: 'image',
      data: { url: buildQrImageUrl(text) },
    });
  },
});
