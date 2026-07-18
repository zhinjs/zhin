import { defineCommand } from '@zhin.js/command';
import handler from '../../src/handlers/fuel-price.js';

export default defineCommand({
  description: '今日油价',
  execute: ({ params }) => handler({ province: params.province != null ? String(params.province) : undefined }),
});
