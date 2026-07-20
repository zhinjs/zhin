import { defineCommand } from '@zhin.js/command';
import handler from '../src/handlers/duanzi.js';

export default defineCommand({
  description: '随机段子',
  execute: () => handler(),
});
