import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '发送制定内容到当前会话',
  execute: ({ segments}) => segments,
});
