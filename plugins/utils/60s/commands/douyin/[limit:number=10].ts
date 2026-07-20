import { defineCommand } from '@zhin.js/command';
import handler from '../../src/handlers/douyin-hot.js';

export default defineCommand({
  description: '抖音热搜',
  execute: ({ params }) => handler({ limit: Number(params.limit) }),
});
