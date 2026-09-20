import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/hitokoto.js';

export default defineCommand({
  description: '随机一言',
  params: { type: { type: 'string' } },
  execute: ({ params, use }) => handler(use(sixtySClientToken), { type: params.type != null ? String(params.type) : undefined }),
});
