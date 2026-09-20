import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/zhihu-hot.js';

export default defineCommand({
  description: '知乎热榜',
  params: { limit: { type: 'number', default: 10 } },
  execute: ({ params, use }) => handler(use(sixtySClientToken), { limit: Number(params.limit) }),
});
