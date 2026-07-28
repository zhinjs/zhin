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

<ZhinDuo heading="一个插件，就这么多">
<template #left>

`plugin.ts` — 入口只有一件事：声明自己。

```ts
import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  name: 'minimal-bot',
  metadata: { displayName: 'Minimal Bot' },
});
```

</template>
<template #right>

`commands/hello.ts` — 命令就是约定目录里的一个文件。

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Say hello',
  execute: () => 'Hello from minimal-bot.',
});
```

</template>

想动用数据库、定时任务、主动推送、Agent 工具？
去 [definePlugin 全景](/authoring/define-plugin) 看看 setup 能做什么。
</ZhinDuo>
