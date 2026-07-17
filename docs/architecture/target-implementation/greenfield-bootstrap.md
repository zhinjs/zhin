# Greenfield Bootstrap 实现状态

> 分支：`feature/next`。代码位于 `packages/next/*`，不依赖旧 Plugin、Feature registry 或兼容层。

## 1. 当前模块

| Package | 已实现的深模块 |
|---|---|
| `@zhin.js/next-kernel` | Identity、Token/Scope、DisposeStack、CapabilitySlot、SnapshotLease、CAS generation、RootController |
| `@zhin.js/next-feature-kit` | `FeatureAuthoring`、`FeatureRuntime`、可选 `FeatureBuildAdapter`、FeatureCatalog、FeatureDiscovery |
| `@zhin.js/next-runtime` | Manifest parser、扁平 workspace validator、workspace/npm resolver、ProjectGraph、ConfigComposer、显式 RuntimeEnvironment Resource、RootRuntime、ESM/Vite ModuleRuntime |
| `@zhin.js/next-feature-command` | `defineCommand()`、`commands/*.ts|tsx` convention、CommandIndex projection 与 owner-scoped execution context |
| `@zhin.js/next-cli` | `init`、`create plugin`、`create feature`、`inspect`、`build`、默认 dry-run 的 `publish` |

临时包名使用 `next-*`，避免旧 workspace 包名冲突。迁移阶段再通过一次明确的 package rename/swap 切换正式入口，不在当前阶段增加 facade 或双写层。

## 2. 已证明的纵向链路

```mermaid
flowchart LR
  Manifest["package.json#zhin"] --> Graph["ProjectGraph"]
  Graph --> Tree["Plugin instance tree"]
  Tree --> Config["Effective schema + owner ConfigView"]
  Tree --> Discovery["Feature-owned discovery"]
  Discovery --> Slot["owner-bound CapabilitySlot"]
  Slot --> Projection["CommandIndex projection"]
  Projection --> Commit["RootController CAS commit"]
  Commit --> Lease["SnapshotLease execution"]
```

测试覆盖以下不变量：

1. `packages/*`、`plugins/*` 只扫描一级，nested workspace 被拒绝。
2. package dependency 与 `zhin.plugins`/`zhin.features` 必须同时存在。
3. 物理 build order 来自 package dependencies，逻辑 Plugin tree 不参与猜测。
4. npm 解析结果不会进入当前 Project 的 build/publish plan。
5. schema 默认值按整树物化，ConfigView 只返回 owner 原始 schema 字段。
6. Command 文件由 provider 发现并投影，不发生模块级注册。
7. 新 generation 发布后，旧 lease 继续执行旧 Command；最后一个 lease 释放前不会 dispose。
8. `stop()` 等待当前 generation drain。
9. Vite adapter 可以直接加载 TS，并在失效后获得新 module exports。

## 3. 当前 HMR 边界

当前 `RootRuntime.reload()` 会重新解析 graph、配置、Plugin setup、Feature discovery 与 projection，然后原子发布完整 generation。这已经提供一致性、失败回滚和新旧 lease 隔离，但还不是目标中的最小 Slot/subtree prepare。

下一阶段新增：

1. `SourceOwnershipIndex`：source -> package -> Plugin -> Slot。
2. `InvalidationPlanner`：slot / Feature projection / Plugin subtree / process 四级升级。
3. generation resource handoff：局部 Slot 重建时复用未变化 Scope，不提前 dispose。
4. watcher coordinator：串行合并文件事件并调用 planner。

在这些模块完成前，不宣称“任意文件都能局部 HMR”。

## 4. 有意保留的后续工作

- `runtime: isolated` 已进入 manifest，但当前明确拒绝启动；Worker/process adapter 尚未实现。
- `engine`、Feature requirement `api` 与 provider `featureApi` 已进入 protocol，semver compatibility gate 尚未接入。
- Page/Layout、Component、Middleware、Agent、Skill、Tool 是后续独立 Feature package，不回填 Kernel 枚举。
- YAML/环境 overlay 属于 ConfigDocument adapter；当前 ConfigComposer 接收解析后的对象。
- publish journal、dist-tag promotion 与失败恢复尚未实现；真实 publish 必须显式 `--execute`。
- 旧 package migration、兼容 facade、codemod 和双版本运行均未开始。

## 5. 验证

```bash
pnpm exec vitest run packages/next
pnpm --filter './packages/next/**' build
pnpm check:doc-links
```
