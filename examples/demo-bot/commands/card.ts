import { defineCommand } from '@zhin.js/command';
import { component } from '@zhin.js/core/runtime';

export default defineCommand({
  description: 'Render the demo status card',
  execute: () => {
    const memory = process.memoryUsage();
    return component('status-card', {
      title: 'Demo',
      lines: [
        { label: 'RSS', value: `${Math.round(memory.rss / 1024 / 1024)}MB` },
        { label: '堆', value: `${Math.round(memory.heapUsed / 1024 / 1024)}MB` },
      ],
    });
  },
});
