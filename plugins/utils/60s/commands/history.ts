import { defineCommand } from '@zhin.js/command';
import handler from '../src/handlers/history-today.js';

export default defineCommand({
  description: '历史上的今天',
  execute: () => handler(),
});
