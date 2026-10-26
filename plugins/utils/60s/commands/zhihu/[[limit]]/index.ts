import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/zhihu-hot.js';

export default defineCommand({
  description: '知乎热榜', descriptionI18n: { en: "Zhihu trending topics" },
  params: { limit: { type: 'number', default: 10 } },
  execute: ({ params, use, locale }) => handler(use(sixtySClientToken), { limit: Number(params.limit) }, locale),
});
