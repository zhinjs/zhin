import { defineCommand } from '@zhin.js/command';
import handler from '../../src/handlers/weibo-hot.js';

export default defineCommand({
  description: '微博热搜',
  execute: ({ params }) => handler({ limit: Number(params.limit) }),
});
