import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Record today mood',
  params: { note: { type: 'string', default: 'good' } },
  execute: ({ params }) => {
    const date = new Date().toLocaleDateString('zh-CN');
    return `已记录：${date} - ${String(params.note)}`;
  },
});
