import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/translate.js';

export default defineCommand({
  description: '文本翻译',
  params: { text: { type: 'string' } },
  execute: ({ params, args, use }) => handler(use(sixtySClientToken), { text: String(params.text), to: args[0] != null ? String(args[0]) : undefined }),
});
