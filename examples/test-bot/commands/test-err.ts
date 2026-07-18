import { defineCommand } from '@zhin.js/command';
import { component } from '@zhin.js/core/runtime';

/** Triggers `async-error` component to exercise Runtime error reporting. */
export default defineCommand({
  description: '异步组件错误处理探测',
  execute: () => component('async-error', {}),
});
