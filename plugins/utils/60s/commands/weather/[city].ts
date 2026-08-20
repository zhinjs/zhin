import { defineCommand } from 'zhin.js/command';
import handler from '../../src/handlers/weather.js';

export default defineCommand({
  description: '查询城市天气',
  params: { city: { type: 'string' } },
  execute: ({ params }) => handler({ city: String(params.city) }),
});
