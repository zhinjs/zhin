import { defineCommand } from 'zhin.js/command';
import { definePlugin } from 'zhin.js/plugin-runtime';

const hello = defineCommand({
  description: '打招呼',
  execute: () => [
    'Hello from single-file-bot!',
    '一个 bot.ts 就是一个机器人。',
  ].join('\n'),
});

export default definePlugin({
  name: 'single-file-bot',
  metadata: {
    displayName: 'Single File Bot',
  },
  setup({ addCommand }) {
    addCommand('hello', hello);
  },
});
