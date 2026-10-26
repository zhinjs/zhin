import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/weather.js';

export default defineCommand({
  description: '查询城市天气', descriptionI18n: { en: "Look up city weather" },
  params: { city: { type: 'string' } },
  execute: ({ params, use, locale }) => handler(use(sixtySClientToken), { city: String(params.city) }, locale),
});
