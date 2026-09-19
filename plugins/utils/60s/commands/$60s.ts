import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../src/client.js';
import handler from '../src/handlers/60s-news.js';

export default defineCommand({
  description: '每日60秒新闻',
  execute: ({ use }) => handler(use(sixtySClientToken)),
});
