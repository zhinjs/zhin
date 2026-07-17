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

每个包的完整契约与示例：

- [Kernel](kernel/README.md)
- [Feature Kit](feature-kit/README.md)
- [Command Feature](feature-command/README.md)
- [Runtime](runtime/README.md)
- [CLI](cli/README.md)

## 当前 Tracer Bullet

```text
package.json#zhin
  -> ProjectGraphService
  -> Plugin instance tree
  -> FeatureDiscovery(commands/**/*.ts|tsx)
  -> CapabilitySlot
  -> CommandIndex projection
  -> RootController commit
  -> SnapshotLease execute

Development ModuleRuntime watcher
  -> reverse importer closure
  -> SourceOwnershipIndex
  -> slot / subtree / process plan
  -> serialized generation transaction
  -> optional Resource handoff
```

默认 Runtime 只提供预编译 ESM adapter，不依赖 Vite、编译器或 watcher。开发期 TS transform/watch 由独立 ModuleRuntime adapter 提供，不能进入 `zhin.js` 默认生产依赖闭包。Capability-only HMR 只重新 load 目标 Slot；child `plugin.ts` / `schema.json` 变化只影子装配对应 Plugin forest。结构化 config patch 先整体验证，再按实际变化的 owner view 计算最浅 forest，不依赖 watcher。以上路径都复用未变化的 Plugin Scope lifetime、重建全部 generation projections，并以完整 immutable snapshot 原子发布。需要暂停 admission 或切换排他连接的 Resource 通过 generation handoff 在 commit 两侧编排；普通 Resource 继续只使用 Scope lifetime。Root、manifest、Feature provider、未知 importer 与拓扑变化仍保守升级为整 generation 重建。

## Validate

```bash
pnpm exec vitest run packages/next
pnpm --filter '@zhin.js/next-*' build
```

CLI 发布默认运行 `pnpm publish --dry-run`。只有显式传入 `zhin-next publish --execute` 才执行真实发布，并且计划只包含当前 workspace package，不会操作 `node_modules` 中解析到的包。
