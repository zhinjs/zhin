import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../src/client.js';
import handler from '../../src/handlers/duanzi.js';

export default defineCommand({
  description: '随机段子', descriptionI18n: { en: "Random joke" },
  execute: ({ use, locale }) => handler(use(sixtySClientToken), locale),
});
