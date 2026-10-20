import { definePlugin } from 'zhin.js';
import { defineCommand } from 'zhin.js/command';
export default definePlugin({
  name: 'single-file-bot',
  setup({ addCommand }) {
    addCommand('hello', defineCommand({
      execute: () => 'hi 我是zhin的第一个机器人'}
    ));
  },
});
