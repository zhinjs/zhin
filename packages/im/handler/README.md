# @zhin.js/handler

Zhin Plugin Runtime 的 Handler Feature。它从 `handlers/**/*.ts` 发现定义，路径段用
`.` 拼接为 localName（与 Lifecycle 事件名对齐），并投影为按事件分桶的 `HandlerIndex`。

依赖 `zhin.js` 的应用请从门面导入（勿再单独安装本包）：

```ts
import { defineHandler } from 'zhin.js/handler';

export default defineHandler({
  event: 'message.receive',
  async handle(message) {
    // fire-and-forget; no next() chain
  },
});
```

省略 `event` 时使用约定路径推导的 localName（例如 `handlers/message/receive.ts` →
`message.receive`）。

依赖 `@zhin.js/core` 的 Root 经 `platformFeatures` 默认继承本 Feature；当前
`ImRuntime` 在入站流水线前接线 `message.receive`。

单文件插件可用 `setup({ addHandler })` 注册，与目录发现进入同一投影。

验证：`pnpm --filter @zhin.js/handler test && pnpm --filter @zhin.js/handler build`。

约定目录说明见 [约定目录](../../../docs/authoring/conventions.md)。
