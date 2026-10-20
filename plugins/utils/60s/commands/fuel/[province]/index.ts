import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/fuel-price.js';

export default defineCommand({
  description: '今日油价',
  params: { province: { type: 'string' } },
  execute: ({ params, use }) => handler(use(sixtySClientToken), { province: params.province != null ? String(params.province) : undefined }),
});
