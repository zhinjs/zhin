import { defineCommand } from '@zhin.js/command';
import handler from '../src/handlers/moyu.js';

export default defineCommand({
  description: '摸鱼日历',
  execute: () => handler(),
});
