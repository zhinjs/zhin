# @zhin.js/handler

Zhin Plugin Runtime 的 Handler Feature。从 `handlers/**/*.ts` 发现定义：capability
localName 用 `/` 分段；投影为 `HandlerIndex` 时把 `/` 映成 `.` 得到 Lifecycle 事件名。

依赖 `zhin.js` 的应用请从门面导入：

```ts
import { defineHandler } from 'zhin.js/handler';

export default defineHandler({
  event: 'notice.receive',
  async handle(notice) {
    await this.interaction?.ask({ type: 'confirm', title: '继续？' });
  },
});
```

`ImRuntime` 经 `sideEventGatewayToken` 分发 `notice.receive` / `request.receive` /
`system.receive`；消息路径分发 `message.receive`。事件字段 `$endpoint` 是不可变的
Endpoint identity；Handler 不暴露 live Endpoint，出站与交互统一使用 generation-bound port。

验证：`pnpm --filter @zhin.js/handler test && pnpm --filter @zhin.js/handler build`。

约定目录说明见 [约定目录](../../../docs/authoring/conventions.md)。
