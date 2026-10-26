import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../src/client.js';
import handler from '../../src/handlers/kfc.js';

export default defineCommand({
  description: 'KFC 文案', descriptionI18n: { en: "KFC copywriting" },
  execute: ({ use, locale }) => handler(use(sixtySClientToken), locale),
});
