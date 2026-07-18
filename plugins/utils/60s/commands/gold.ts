import { defineCommand } from '@zhin.js/command';
import handler from '../src/handlers/gold-price.js';

export default defineCommand({
  description: '今日金价',
  execute: () => handler(),
});
