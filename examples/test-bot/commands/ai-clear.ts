import { defineCommand } from '@zhin.js/command';

/** 提示：会话清空走 `ai: clear`（ZhinAgent IM session）。 */
export default defineCommand({
  description: '说明如何清空 AI 多轮上下文',
  execute: () => [
    '清空当前会话 AI 上下文：发送 `ai: clear`（或 `ai: 清空`）。',
    'Agent Host 经 ZhinAgent 按 IM session key 隔离多轮（内存，重启丢失）。',
  ].join('\n'),
});
