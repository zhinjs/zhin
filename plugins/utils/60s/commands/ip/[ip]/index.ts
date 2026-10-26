import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../../src/client.js';
import handler from '../../../src/handlers/ip-query.js';

export default defineCommand({
  description: 'IP 查询', descriptionI18n: { en: "Look up an IP address" },
  params: { ip: { type: 'string' } },
  execute: ({ params, use, locale }) => handler(use(sixtySClientToken), { ip: params.ip != null ? String(params.ip) : undefined }, locale),
});
