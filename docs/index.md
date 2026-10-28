---
layout: home
---

<ZhinHero tagline="一个 Bot 同时管好 QQ、微信、Discord、Telegram 等 20+ 平台的群：运营和群主在浏览器里管，开发者用 TypeScript 写一次、到处运行。默认小巧，需要时再加 AI。" />

<ZhinTerminal>
<b>$</b> npm create zhin-app my-bot -y<br>
<b>$</b> cd my-bot && pnpm dev<br>
<span>✔ Bot 已启动 —— 不需要平台账号，也不需要模型 Key</span>
</ZhinTerminal>

<ZhinAudienceSplit />

<ZhinRolePaths />

<ZhinFeatureGrid />

<ZhinDuo heading="一个 Bot 长什么样">
<template #left>

**最小形态**：一个 `bot.ts` 就是整个机器人。

```ts
import { definePlugin } from 'zhin.js';
import { defineCommand } from 'zhin.js/command';

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

**功能变多后**：每个能力一个文件，放进约定目录即自动注册。

```text
my-bot/
├── plugin.ts                 # 入口：definePlugin()
├── commands/hello/index.ts   # /hello 命令
├── middlewares/…             # 关键词回复、过滤
├── tools/…                   # 给 AI 调用的工具（可选）
└── zhin.config.yml           # 端口、平台凭据、模型等配置
```

</template>
<template #right>

**10 分钟跑通**（无需任何账号或 Key）：

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```

1. 打开 [console.zhin.dev](https://console.zhin.dev)
2. 填入终端打印的地址和 `.env` 里的 `HTTP_TOKEN`
3. 在 Sandbox 里发送 `/hello`

**接下来**

- 运营 / 群主，不写代码？→ [运营与群管指南](/customer/)
- 名词看不懂？→ [核心概念速览](/getting-started/concepts)
- 写自己的命令 → [第一个插件](/getting-started/first-plugin)
- 接入真实平台 → [平台适配器](/adapters/)
- 加 AI → [AI 总览](/ai/)

</template>
</ZhinDuo>
