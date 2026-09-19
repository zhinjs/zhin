import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '查看 Playground 可用命令',
  execute: () =>
    [
      'Zhin.js Playground 可用命令：',
      '',
      '  /hello [name]  — 向你问好',
      '  /playground    — 查看本帮助',
      '  /echo <msg>    — 复读你的消息',
      '  /time          — 查看当前时间',
      '  /dice [faces]  — 掷骰子',
      '',
      'AI（OpenRouter free）：',
      '  ai: 你好       — 前缀触发 Agent',
      '  #帮我写一句诗  — 也可用 # / AI:',
      '',
      '完整 Console：https://console.zhin.dev',
      'API Base：https://zhinjs-demo.hf.space',
      'Token：zhin-demo',
    ].join('\n'),
});
