import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: 'Stable IM command smoke',
  execute: () => [
    'Hello from minimal-bot.',
    'Try /card to render the status component.',
    'Type commands directly in this terminal.',
  ].join('\n'),
});
