import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../../src/client.js';
import handler from '../../src/handlers/gold-price.js';

export default defineCommand({
  description: '今日金价',
  execute: ({ use }) => handler(use(sixtySClientToken)),
});
