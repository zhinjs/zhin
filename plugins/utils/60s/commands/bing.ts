import { defineCommand } from '@zhin.js/command';
import handler from '../src/handlers/bing-image.js';

export default defineCommand({
  description: 'Bing 每日壁纸',
  execute: () => handler(),
});
