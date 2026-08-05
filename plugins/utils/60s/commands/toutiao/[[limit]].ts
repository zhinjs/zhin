import { defineCommand } from '@zhin.js/command';
import handler from '../../src/handlers/toutiao-hot.js';

export default defineCommand({
  description: '头条热搜',
  params: { limit: { type: 'number', default: 10 } },
  execute: ({ params }) => handler({ limit: Number(params.limit) }),
});
