import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/fuel-price.js';

export default defineCommand({
  description: '今日油价', descriptionI18n: { en: "Today's fuel prices" },
  params: { province: { type: 'string' } },
  execute: ({ params, use, locale }) => handler(use(sixtySClientToken), { province: params.province != null ? String(params.province) : undefined }, locale),
});
