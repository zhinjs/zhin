import { defineCommand } from 'zhin.js/command';
import handler from '../../src/handlers/douyin-hot.js';

export default defineCommand({
  description: '抖音热搜',
  params: { limit: { type: 'number', default: 10 } },
  execute: ({ params }) => handler({ limit: Number(params.limit) }),
});
