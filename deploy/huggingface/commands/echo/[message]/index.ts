import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '复读你说的话',
  params:{
    message: {
      type: 'text',
      description: '要复读的消息',
    },
  },
  execute: ({ params }) => String(params.message),
});
