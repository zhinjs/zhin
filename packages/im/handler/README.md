# @zhin.js/handler

Zhin Plugin Runtime 的 Handler Feature。从 `handlers/<name>/index.ts` 发现定义；每个
Handler 在定义中显式声明 Lifecycle 事件名。

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
