import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: 'Plugin Runtime smoke — reply pong',
  execute: () => 'pong (test-bot Plugin Runtime)',
});
