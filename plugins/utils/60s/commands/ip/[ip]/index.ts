import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/ip-query.js';

export default defineCommand({
  description: 'IP 查询',
  params: { ip: { type: 'string' } },
  execute: ({ params, use }) => handler(use(sixtySClientToken), { ip: params.ip != null ? String(params.ip) : undefined }),
});
