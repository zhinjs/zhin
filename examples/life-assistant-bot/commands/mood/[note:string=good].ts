import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: 'Record today mood',
  execute: ({ params }) => {
    const date = new Date().toLocaleDateString('zh-CN');
    return `已记录：${date} - ${String(params.note)}`;
  },
});
