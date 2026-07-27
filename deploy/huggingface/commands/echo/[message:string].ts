import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '复读你说的话',
  execute: ({ params }) => String(params.message),
});
