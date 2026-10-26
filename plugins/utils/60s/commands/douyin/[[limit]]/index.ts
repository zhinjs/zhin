import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/douyin-hot.js';

export default defineCommand({
  description: '抖音热搜', descriptionI18n: { en: "Douyin trending topics" },
  params: { limit: { type: 'number', default: 10 } },
  execute: ({ params, use, locale }) => handler(use(sixtySClientToken), { limit: Number(params.limit) }, locale),
});
