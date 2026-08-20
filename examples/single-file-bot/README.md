# single-file-bot

**一个 `bot.ts` 就是一个机器人。** 不建 `commands/`、`components/` 等任何子目录。

```ts
import { defineCommand } from 'zhin.js/command';
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'single-file-bot',
  setup({ addCommand }) {
    addCommand('hello', defineCommand({
      description: '打招呼',
      execute: () => 'Hello from single-file-bot!',
    }));
  },
});
```

## 30 秒跑起来

本仓库内（根目录已 `pnpm install`）：

```bash
pnpm --filter single-file-bot dev
```

独立拷贝本目录时：

```bash
pnpm install
pnpm dev          # = zhin runtime start
```

然后：

1. 打开 [Remote Console](https://console.zhin.dev)
2. Host 填 `http://127.0.0.1:8086`（本示例未配 `http.token`，仅限本机）
3. 进入 **Sandbox / 沙盒**，发送 **`/hello`**

应收到 `Hello from single-file-bot!` 一类回复。编辑 `bot.ts` 会热重载。

> Sandbox 默认 `commandPrefix: '/'`，所以发 `/hello`。若自己把前缀改成空字符串，发 `hello` 即可。

## 它是怎么工作的

- `package.json#zhin.entry` → `./bot.ts`，`zhin runtime start` 加载默认导出的 `definePlugin`
- `zhin.plugins` 挂 `@zhin.js/adapter-sandbox`（可选再挂真实平台，如 `@zhin.js/adapter-icqq`）
- `setup()` 里 `addCommand('hello', …)` 与 `commands/` 目录发现进**同一个** `CommandIndex`（冲突检查、generation 事务一致）

## 什么时候该升级成目录布局

单文件适合 demo / 一次性脚本。出现以下任一需求时，改用约定式布局
（[minimal-bot](../minimal-bot/) 或 `npm create zhin-app`）：

- 能力变多，需要按文件分工
- 带参数文件路由（如 `commands/remind/[time].ts`）
- 希望改单个能力时只重建对应 Feature projection，而不是重载整个单文件插件

`setup()` 同样支持 `addComponent`、`addMiddleware`、`addAdapter`；自定义 Feature 用
`addFeature(featureId, localName, definition)`。拆成目录后 definition 不用改，默认导出到对应约定文件即可。
