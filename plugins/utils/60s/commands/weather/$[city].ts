import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../src/client.js';
import handler from '../../src/handlers/weather.js';

export default defineCommand({
  description: '查询城市天气',
  params: { city: { type: 'string' } },
  execute: ({ params, use }) => handler(use(sixtySClientToken), { city: String(params.city) }),
});
