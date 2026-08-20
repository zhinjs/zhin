# @zhin.js/handler

Zhin Plugin Runtime 的 Handler Feature。它从 `handlers/**/*.ts` 发现定义：capability
localName 用 `/` 分段（符合 runtime 身份规则），投影为 `HandlerIndex` 时把 `/` 映成
`.`，得到 Lifecycle 事件名。

依赖 `zhin.js` 的应用请从门面导入（勿再单独安装本包）：

```ts
import { defineHandler } from 'zhin.js/handler';

export default defineHandler({
  // 可省略：handlers/message/receive.ts → localName message/receive → event message.receive
  event: 'message.receive',
  async handle(message) {
    // fire-and-forget; no next() chain
  },
});
```

省略 `event` 时：`handlers/notice/receive.ts` → localName `notice/receive` → 监听
`notice.receive`。

依赖 `@zhin.js/core` 的 Root 经 `platformFeatures` 默认继承本 Feature；当前
`ImRuntime` 在入站流水线前接线 `message.receive`。

单文件插件可用 `setup({ addHandler })` 注册，与目录发现进入同一投影；`addHandler`
的 localName 同样用 `/`（如 `addHandler('notice/receive', defineHandler({ handle }))`）。

验证：`pnpm --filter @zhin.js/handler test && pnpm --filter @zhin.js/handler build`。

约定目录说明见 [约定目录](../../../docs/authoring/conventions.md)。
