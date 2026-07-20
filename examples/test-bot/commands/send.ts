import { defineCommand } from '@zhin.js/command';

/** 对齐 legacy `send`：把剩余参数原样回显。 */
export default defineCommand({
  description: '回显剩余参数（send 冒烟）',
  execute: ({ args }) => (args.length > 0 ? args.join(' ') : '(empty)'),
});
