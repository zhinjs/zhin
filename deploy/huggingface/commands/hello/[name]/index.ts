import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '向你问好',
  params:{
    name: {
      type: 'text',
      description: '你的名字',
    },
  },
  execute: ({ params }) =>
    `你好，${params.name}！欢迎使用 Zhin.js 4.x Playground。`,
});
