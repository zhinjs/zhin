# Greenfield Bootstrap 实现状态

> 分支：`feature/next`。代码位于 `packages/next/*`，不依赖旧 Plugin、Feature registry 或兼容层。

## 1. 当前模块

| Package | 已实现的深模块 |
|---|---|
| `@zhin.js/next-kernel` | Identity、Token/Scope、DisposeStack、CapabilitySlot、SnapshotLease、CAS generation、RootController |
| `@zhin.js/next-feature-kit` | `FeatureAuthoring`、`FeatureRuntime`、可选 `FeatureBuildAdapter`、FeatureCatalog、FeatureDiscovery |
| `@zhin.js/next-runtime` | Manifest parser、扁平 workspace validator、workspace/npm resolver、ProjectGraph、ConfigComposer、显式 RuntimeEnvironment Resource、RootRuntime、ESM ModuleRuntime、SourceOwnershipIndex、InvalidationPlanner、HmrCoordinator |
| `@zhin.js/next-feature-command` | `defineCommand()`、`commands/**/*.ts|tsx` convention、层级命令词、CommandIndex projection 与 owner-scoped execution context |
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
  Watch["Development watcher + importer closure"] --> Plan["slot / subtree / process plan"]
  Plan --> Commit
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
9. 默认 ESM adapter 不携带 TS compiler、watcher 或前端构建依赖。
10. 同一 source 可以归属于多个 Plugin mount；Feature provider 变化会覆盖所有 owner。
11. capability、Plugin/schema/manifest 与 lockfile 分别升级为 slot、subtree 与 process 计划。
12. watcher burst 合并为串行 transaction，失败会通知并拒绝整批 waiter。
13. ModuleRuntime port 允许独立开发 adapter 提供 reverse importer closure，不污染生产 Runtime。
14. Slot HMR 只 load 选中的 definition，不重新 import Feature provider 或执行 Plugin setup。
15. Plugin Scope 通过引用计数 lifetime 跨 generation 存活；旧 lease 释放不会提前关闭共享 Resource。
16. definition 校验失败保持 active generation；删除 capability 文件会原子移除对应 Slot。
17. 排他 Resource 可注册 generation handoff；transaction 在 commit 前 quiesce/activate，失败时 deactivate/resume，commit 后再开放 admission。
18. `ConfigPatchPlanner` 对结构化 set/remove patch 做整树校验，比较 owner view 后计算最浅 replacement forest；patch 队列串行且 no-op 不发布 generation。
19. manifest topology transaction 局部处理 child/Feature mount 的新增、删除和移动；稳定 Scope 复用，移动 Scope 按新 owner 重建，等价 manifest 不发布 generation。
20. Root setup/schema、package ESM ABI、engine、Feature API 与 Plugin runtime 变化升级为 process plan；可选 executor 在 drain/stop Root 后只调用一次 Host restart adapter。

## 3. 当前 HMR 边界

当前控制面已经完整：`SourceOwnershipIndex` 从 committed generation 建索引；`InvalidationPlanner` 结合 ModuleRuntime reverse importer closure 生成 slot/subtree/process 计划；`HmrCoordinator` 合并 watcher burst 并串行调用 `RootRuntime`。lockfile/workspace 变化只发出 process restart 请求。

Capability-only 计划已经进入局部执行面：FeatureDiscovery 枚举完整约定目录以保留冲突检查，但只 load 选中的 Slot；Plugin tree、配置和 Resource snapshot 直接复用。child Plugin/schema 计划通过 `PluginScopeAssembler` 只创建受影响 forest 的 shadow Scope，ancestor 和 sibling 直接复用。manifest topology transaction 在完整解析候选 graph 后，只 setup added/replaced child forest；removed child 退出候选 snapshot，旧 Scope 继续由旧 generation lease 持有；Feature mount 增删移动只刷新 owner Slot。`FeatureProjector` 统一为四种装配路径重建全部 projection，避免 projection 捕获旧 snapshot。每个 Plugin Scope 都有独立 `SharedLifetime`；新旧 generation 分别持有 lease，最后一代释放后才 children-first dispose。

commit 仍然发布完整 immutable RuntimeSnapshot；“局部”只描述 prepare/load/setup/dispose 范围，不表示原地修改 snapshot。definition 加载、校验或 projection 任一步失败都销毁 shadow projection 并保持 active generation。

下一阶段继续收紧配置持久化边界：

1. ConfigDocument adapter：用 YAML AST 将已验证 patch 持久化并保留注释、环境变量表达式与格式。

当前可宣称 Capability 文件、child Plugin/schema 与 manifest topology 的局部替换，以及 Root/package ABI 的受控 process restart。Feature provider 源码、未知 importer 和混合 burst 仍采用事务化整代重建；这是明确的安全边界，不是静默降级。

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
pnpm --filter @zhin.js/next-runtime check:size
pnpm check:doc-links
```
