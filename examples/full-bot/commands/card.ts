import { defineCommand } from '@zhin.js/command';
import { component } from '@zhin.js/core/runtime';

export default defineCommand({
  description: 'Render the L4 status card',
  execute: () => {
    const memory = process.memoryUsage();
    return component('status-card', {
      title: 'full-bot',
      lines: [
        { label: 'RSS', value: `${Math.round(memory.rss / 1024 / 1024)}MB` },
        { label: 'Heap', value: `${Math.round(memory.heapUsed / 1024 / 1024)}MB` },
      ],
    });
  },
});
