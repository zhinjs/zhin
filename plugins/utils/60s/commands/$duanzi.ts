import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../src/client.js';
import handler from '../src/handlers/duanzi.js';

export default defineCommand({
  description: '随机段子',
  execute: ({ use }) => handler(use(sixtySClientToken)),
});
