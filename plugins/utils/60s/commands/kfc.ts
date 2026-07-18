import { defineCommand } from '@zhin.js/command';
import handler from '../src/handlers/kfc.js';

export default defineCommand({
  description: 'KFC 文案',
  execute: () => handler(),
});
