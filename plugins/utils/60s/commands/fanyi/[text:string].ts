import { defineCommand } from '@zhin.js/command';
import handler from '../../src/handlers/translate.js';

export default defineCommand({
  description: '文本翻译',
  execute: ({ params, args }) => handler({ text: String(params.text), to: args[0] != null ? String(args[0]) : undefined }),
});
