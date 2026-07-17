# Zhin Next Greenfield Stack

`packages/next/*` 是 `feature/next` 分支上的全新实现，不依赖旧 Plugin、Feature registry 或兼容层。临时包名使用 `@zhin.js/next-*`，迁移阶段再决定何时替换正式包名。

## Packages

| Package | Deep module |
|---|---|
| `@zhin.js/next-kernel` | 稳定 identity、Scope、Slot、Snapshot lease、CAS generation 与 RootController |
| `@zhin.js/next-feature-kit` | Feature authoring/runtime/build contract、provider catalog 与 owner-aware discovery |
| `@zhin.js/next-runtime` | 静态 manifest、workspace/npm resolution、Project Graph、配置组合、RuntimeEnvironment、source ownership、失效规划、HMR 协调与 Root 装配 |
| `@zhin.js/next-feature-command` | 第一套标准 Feature provider 与 generation-scoped CommandIndex |
| `@zhin.js/next-cli` | Plugin monorepo 初始化、子包创建、inspect、build 与安全 publish plan |

## 当前 Tracer Bullet

```text
package.json#zhin
  -> ProjectGraphService
  -> Plugin instance tree
  -> FeatureDiscovery(commands/*.ts)
  -> CapabilitySlot
  -> CommandIndex projection
  -> RootController commit
  -> SnapshotLease execute

Development ModuleRuntime watcher
  -> reverse importer closure
  -> SourceOwnershipIndex
  -> slot / subtree / process plan
  -> serialized generation transaction
```

默认 Runtime 只提供预编译 ESM adapter，不依赖 Vite、编译器或 watcher。开发期 TS transform/watch 由独立 ModuleRuntime adapter 提供，不能进入 `zhin.js` 默认生产依赖闭包。Capability-only HMR 已只重新 load 目标 Slot，复用 Plugin Scope lifetime 并重建 generation projections；Plugin/schema/manifest 变化暂时仍采用整 generation 安全重建。

## Validate

```bash
pnpm exec vitest run packages/next
pnpm --filter '@zhin.js/next-*' build
```

CLI 发布默认运行 `pnpm publish --dry-run`。只有显式传入 `zhin-next publish --execute` 才执行真实发布，并且计划只包含当前 workspace package，不会操作 `node_modules` 中解析到的包。
