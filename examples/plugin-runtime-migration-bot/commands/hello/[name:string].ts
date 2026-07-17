import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  execute: ({ params }) => `hello ${params.name}`,
});
