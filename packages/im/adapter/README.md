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

## Adapter ↔ Endpoint：固定 1 对多

一个 adapter 插件实例固定对应一到多个 endpoint：

- `plugins.<adapter>` 配置该 adapter 所有 endpoint 的**通用配置**（如凭据共享字段、
  `master`、`intents`）。
- `plugins.<adapter>.endpoints[index]` 配置单个 endpoint 的**特殊配置**，逐项覆盖通用
  配置，`name` 必填。
- 不写 `endpoints` 时退化为单 endpoint（历史行为），实例 config 原样传给 `create()`。

展开由 `expandEndpointConfigs`（`src/adapter-index.ts`）完成：endpoint record id 为
`<slotId>~<name>`，合并顺序 `{...通用, ...项}`（项优先），`endpoints` 键不下传给适配器。
多账号示例见 `plugins/adapters/icqq` / `plugins/adapters/qq` 的 README 与 schema。

验证：`pnpm --filter @zhin.js/adapter test && pnpm --filter @zhin.js/adapter build`。

架构说明见 [Plugin Monorepo 与 Feature Provider](../../../docs/architecture/target-implementation/plugin-monorepo-and-features.md)。
