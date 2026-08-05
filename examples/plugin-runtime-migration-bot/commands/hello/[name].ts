import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  params: { name: { type: 'string' } },
  execute: ({ params }) => `hello ${params.name}`,
});
