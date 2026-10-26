import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../src/client.js';
import handler from '../../src/handlers/history-today.js';

export default defineCommand({
  description: '历史上的今天', descriptionI18n: { en: "Today in history" },
  execute: ({ use, locale }) => handler(use(sixtySClientToken), locale),
});
