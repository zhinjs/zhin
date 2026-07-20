import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: 'Demo smoke command',
  execute: () => [
    '你好！这是 Zhin.js 官方 Demo。',
    '试试 card 查看状态卡片。',
    '试试 ai: 你好 体验 Agent 对话。',
    '部署到本机：pnpm create zhin-app',
  ].join('\n'),
});
