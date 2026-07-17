# Greenfield Bootstrap 实现状态

> 分支：`feature/next`。代码位于 `packages/next/*`，不依赖旧 Plugin、Feature registry 或兼容层。

## 1. 当前模块

| Package | 已实现的深模块 |
|---|---|
| `@zhin.js/plugin-runtime` | Identity、Token/Scope、DisposeStack、CapabilitySlot、SnapshotLease、CAS generation、RootController |
| `@zhin.js/feature-kit` | `FeatureAuthoring`、`FeatureRuntime`、可选 `FeatureBuildAdapter`、FeatureCatalog、FeatureDiscovery |
| `@zhin.js/runtime` | Manifest parser、workspace/npm resolver、ProjectGraph、ConfigComposer、RuntimeEnvironment/owner EnvStore、RootRuntime、Node 原生开发 ModuleRuntime、source ownership、HMR 与 process restart |
| `@zhin.js/next-isolate` | 可选 Worker/child-process adapter、structured-clone RPC、generation drain/handoff 与 crash propagation |
| `@zhin.js/next-config-yaml` | 可选 ConfigDocumentPort、YAML AST patch、revision conflict 与原子文件替换 |
| `@zhin.js/next-compat` | 可删除的 legacy Command/Middleware callback definition adapter |
| `@zhin.js/next-feature-command` | `defineCommand()`、`commands/**/*.ts|tsx` convention、层级命令词、CommandIndex projection 与 owner-scoped execution context |
| `@zhin.js/next-feature-middleware` | `defineMiddleware()`、`middlewares/**/*.ts`、确定性排序、onion compose 与 MiddlewareIndex |
| `@zhin.js/next-feature-component` | `defineComponent()`、`components/**/*.ts|tsx`、owner override/ancestor fallback 与 ComponentIndex |
| `@zhin.js/next-feature-adapter` | `defineAdapter()`、`adapters/**/*.ts`、Endpoint lifecycle、generation handoff 与 AdapterIndex |
| `@zhin.js/next-im` | MessageGateway、SnapshotLease inbound、Command Dispatcher、Component Renderer、统一 outbound middleware/send |
| `@zhin.js/next-feature-tool` | `defineAgentTool()`、`tools/*.ts`、owner-scoped ToolIndex |
| `@zhin.js/next-feature-skill` | `skills/*/SKILL.md`、immutable Markdown SkillIndex |
| `@zhin.js/next-feature-agent` | `agents/*.agent.md`、immutable Markdown AgentIndex |
| `@zhin.js/next-feature-mcp` | `mcp/*.ts`、provider-neutral client 与 generation lifecycle |
| `@zhin.js/agent/runtime` | CapabilityIngress、owner-visible handles、snapshot-coherent turn lease |
| `@zhin.js/console-contract` | 零依赖 Page/Layout manifest、route、Navigation 与 Shell slot contract |
| `@zhin.js/page` | `pages/*.ts|tsx`、Client Module artifact 校验、canonical route 与 PageIndex |
| `@zhin.js/layout` | `$nav.tsx`/`$footer.tsx`、最近祖先继承与 renderer fallback chain |
| `@zhin.js/pagemanager/plugin-runtime` | permission-aware route guard、Plugin Navigation、Layout resolver 与 view lease |
| `@zhin.js/pagemanager/client-build` | 可选 TypeScript AST metadata、content-hash ESM/manifest、development builder 与 production loader |
| `@zhin.js/next-cli` | `init`、`create`、`inspect`、原生 TS `start`、两阶段 migrate/readiness、`build` 与安全 publish |

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
21. ConfigDocumentPort 将原始文档与 materialized config 分离；YAML adapter 保留注释/表达式/格式，并与 Resource handoff、generation CAS 共同回滚。
22. Root 显式冻结 EnvironmentLayers，并为每个 Plugin Scope 注入独立 EnvStore；overlay、`${KEY}` 展开、schema parse 与 secret redaction 不读取模块全局状态。
23. Graph inspect 在模块 import/setup 前校验 Runtime engine 与 Feature API semver contract；不兼容候选不产生副作用，兼容 contract 变化升级为 process restart。
24. Middleware 与 Component 均由独立 Feature package 提供；目录发现、definition brand、owner context、projection 与单 Slot HMR 已完成纵向验证。
25. Adapter Endpoint 由 Feature projection handoff 纳入 generation transaction；create/start/open/close/stop 的切代顺序、失败清理和旧 lease 延迟 dispose 已验证。
26. IM Runtime 已贯通 inbound Middleware、最长前缀 Command、Component render、outbound Middleware 与唯一 Endpoint send；消息处理中提交 generation 不会撕裂 snapshot。
27. Tool、Skill、Agent、MCP 均由独立 Feature 提供；项目根与 Plugin 根使用同一发现格式，owner override 和 qualified identity 由共享索引确定。
28. AgentRuntime 一次 turn lease 同一 generation；Tool 使用声明 owner config/resource，MCP connection 参与 handoff，逃逸执行 handle 在 turn 后失效。
29. Page/Layout 浏览器模块只经 Client Module artifact port 加载，Node 不 import TSX；单文件 HMR 不重跑 Plugin setup，编译失败保持旧 generation。
30. ConsoleRuntime 在同一 view lease 中完成 route guard、permission filter、Navigation 建树与 Layout fallback；`hideInNav` 不绕过直访鉴权。
31. Client build adapter 通过 TypeScript AST 只提取 `definePage()` JSON-like literal；动态表达式带源码位置失败，构建不执行作者模块。
32. Publish execute 先写 plan-specific staging dist-tag，全部发布后再 promote；journal 原子记录每个远程 step，resume 使用 registry probe 关闭崩溃窗口。
33. `runtime: isolated` child 通过可选 Worker/process adapter 启动；entry 不在 Host import，旧 RPC drain 后切代，候选 setup 失败恢复旧实例，崩溃与超时使实例明确失效。
34. Next 公开 root/subpath 导出进入 API snapshot；CLI 可 AST inventory/extract 静态 MessageCommand，compat 只转换 callback，不恢复旧 registry。
35. Command/Middleware/Component extraction、package cutover 与 readiness 状态机已完成；真实双版本 tracer 可读取 YAML、原生加载 TS、提交 generation 并 drain/stop。
36. 原生开发 Runtime 使用 URL revision 局部刷新直接 capability；无法清除 importer closure 的 support module 明确升级为退出码 75 的 process restart。

## 3. 当前 HMR 边界

当前控制面已经完整：`SourceOwnershipIndex` 从 committed generation 建索引；`InvalidationPlanner` 结合 ModuleRuntime reverse importer closure 生成 slot/subtree/process 计划；`HmrCoordinator` 合并 watcher burst 并串行调用 `RootRuntime`。lockfile/workspace 变化只发出 process restart 请求。

Capability-only 计划已经进入局部执行面：FeatureDiscovery 枚举完整约定目录以保留冲突检查，但只 load 选中的 Slot；Plugin tree、配置和 Resource snapshot 直接复用。child Plugin/schema 计划通过 `PluginScopeAssembler` 只创建受影响 forest 的 shadow Scope，ancestor 和 sibling 直接复用。manifest topology transaction 在完整解析候选 graph 后，只 setup added/replaced child forest；removed child 退出候选 snapshot，旧 Scope 继续由旧 generation lease 持有；Feature mount 增删移动只刷新 owner Slot。`FeatureProjector` 统一为四种装配路径重建全部 projection，避免 projection 捕获旧 snapshot。每个 Plugin Scope 都有独立 `SharedLifetime`；新旧 generation 分别持有 lease，最后一代释放后才 children-first dispose。

commit 仍然发布完整 immutable RuntimeSnapshot；“局部”只描述 prepare/load/setup/dispose 范围，不表示原地修改 snapshot。definition 加载、校验或 projection 任一步失败都销毁 shadow projection 并保持 active generation。

绿地建设已经完成，迁移控制面也已具备 extraction、cutover、readiness 与真实 Root smoke。下一阶段进入首批仓库 Plugin 批量迁移和发布 manifest artifact。

当前可宣称 Capability 文件、child Plugin/schema 与 manifest topology 的局部替换，以及 Root/package ABI 的受控 process restart。Feature provider 源码、未知 importer 和混合 burst 仍采用事务化整代重建；这是明确的安全边界，不是静默降级。

## 4. 有意保留的后续工作

- `runtime: isolated` Worker/process adapter 已实现；普通 Feature 跨边界仍需 Feature-specific codec/proxy，当前明确拒绝隐式函数序列化。
- Runtime engine 与 Feature API semver compatibility gate 已实现。
- Page/Layout 独立 Feature、Console contract/runtime 与可选 TypeScript client build/manifest adapter 已实现。
- YAML ConfigDocument adapter、类型化 EnvStore、环境 overlay 与 secret redaction 已实现。
- publish journal、staging dist-tag promotion 与 registry-aware `--resume` 已实现；真实 publish 仍必须显式 `--execute` 或 `--resume`。
- 旧 package migration 控制面已完成：三类 AST extraction、entry/manifest cutover、readiness import inventory 与双版本 Root smoke 均有测试。尚未完成的是仓库真实 Plugin 批量搬迁、Plugin 发布 JS entry 与 compat 清零。

## 5. 建设与迁移余量

以下估算以“一次 focused stage 完成设计、代码、测试、README、SSOT 和提交”为单位，不把只写接口视为完成：

| 区段 | 剩余 focused stages | 主要内容 |
|---|---:|---|
| 绿地建设 | 0 | API snapshot 与隔离并发 soak 已完成，公共面进入冻结 |
| 旧代码迁移 | 5–9 | 发布 manifest artifact；Core/Agent/Console；Adapters；services/utils；examples 与正式入口切换 |
| 稳定化 | 3–5 | 双版本对照、真实平台验收、性能/体积、安全门禁、release candidate |

当前绿地底座完成度约 100%，把迁移与稳定化计入后的整体替换完成度约 70%。按当前批量推进节奏，还需约 8–14 个 focused stages；代码迁移仍可争取在约 3–5 周收口，达到可替换稳定版本更现实的区间是 5–8 周。真实 IM 平台验收、外部插件反馈或兼容范围扩大时应更新本表，不压缩测试来追日期。

## 6. 验证

```bash
pnpm exec vitest run packages/next
pnpm --filter './packages/next/**' build
pnpm check:install-size
pnpm --filter @zhin.js/next-isolate check:size
pnpm --filter @zhin.js/next-compat check:size
pnpm --filter @zhin.js/next-cli check:api
pnpm --filter @zhin.js/next-cli check:size
pnpm check:doc-links
```
