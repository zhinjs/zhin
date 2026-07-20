import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: 'Record a reminder request',
  execute: ({ params }) => `已记录提醒：${String(params.text)}`,
});
