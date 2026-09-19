import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../src/client.js';
import handler from '../src/handlers/moyu.js';

export default defineCommand({
  description: '摸鱼日历',
  execute: ({ use }) => handler(use(sixtySClientToken)),
});
