import { defineCommand } from '@zhin.js/command';
import handler from '../../src/handlers/ip-query.js';

export default defineCommand({
  description: 'IP 查询',
  execute: ({ params }) => handler({ ip: params.ip != null ? String(params.ip) : undefined }),
});
