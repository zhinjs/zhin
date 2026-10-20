import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../src/client.js';
import handler from '../../src/handlers/bing-image.js';

export default defineCommand({
  description: 'Bing 每日壁纸',
  execute: ({ use }) => handler(use(sixtySClientToken)),
});
