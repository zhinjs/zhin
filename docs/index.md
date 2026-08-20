---
layout: home
---

<ZhinHero tagline="为生活与工作助手 Bot 而生的多通道 IM 框架。插件是乐高，热重载是日常，Console 就在浏览器里。" />

<ZhinTerminal>
<b>$</b> npm create zhin-app my-bot<br>
<b>$</b> cd my-bot && pnpm dev<br>
<span>✔ IM 黄金路径启动 —— 不需要任何模型 Key</span>
</ZhinTerminal>

<ZhinFeatureGrid />

<ZhinDuo heading="一个文件，就能打招呼">
<template #left>

`bot.ts` — 整个机器人可以就是这一份文件。

```ts
import { defineCommand } from 'zhin.js/command';
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-bot',
  setup({ addCommand }) {
    addCommand('hello', defineCommand({
      description: '打招呼',
      execute: () => 'Hello from Zhin!',
    }));
  },
});
```

</template>
<template #right>

三步跑起来（无需模型 Key）：

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```

打开 [console.zhin.dev](https://console.zhin.dev) →
Sandbox → `/hello`。

想拆成约定目录？`commands/hello.ts` 默认导出同一个
`defineCommand(...)` 即可——见 [minimal-bot](/examples/#minimal-bot-stable-最小路径)。

</template>

完整单文件示例：[single-file-bot](/examples/#single-file-bot-一个-botts-就是机器人)。
数据库、定时、主动推送、Agent？去 [definePlugin 全景](/authoring/define-plugin) 看 `setup`。
</ZhinDuo>
