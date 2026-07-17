# @zhin.js/adapter

Zhin Plugin Runtime 的 Adapter Feature。它从插件或项目的 `adapters/**/*.ts` 发现
`defineAdapter()` 定义，按 Plugin owner 投影 Endpoint，并把 start/open/close/stop 纳入同一
generation handoff。

```ts
import { defineAdapter } from '@zhin.js/adapter';

export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  create: (context) => ({ name: context.name }),
});
```

本包只依赖 Kernel 与 Feature Kit，不包含具体平台 SDK。生产 manifest 指向
`lib/provider.js`；开发时可通过 conditional export 读取源码。

验证：`pnpm --filter @zhin.js/adapter test && pnpm --filter @zhin.js/adapter build`。

架构说明见 [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)。
