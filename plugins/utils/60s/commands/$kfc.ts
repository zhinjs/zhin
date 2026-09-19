import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../src/client.js';
import handler from '../src/handlers/kfc.js';

export default defineCommand({
  description: 'KFC 文案',
  execute: ({ use }) => handler(use(sixtySClientToken)),
});
