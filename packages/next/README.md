# Zhin Next Greenfield Stack

`packages/next/*` 是 `feature/next` 分支上的全新实现，不依赖旧 Plugin、Feature registry 或兼容层。临时包名使用 `@zhin.js/next-*`，迁移阶段再决定何时替换正式包名。

## Packages

| Package | Deep module |
|---|---|
| `@zhin.js/next-kernel` | 稳定 identity、Scope、Slot、Snapshot lease、CAS generation 与 RootController |
| `@zhin.js/next-feature-kit` | Feature authoring/runtime/build contract、provider catalog 与 owner-aware discovery |
| `@zhin.js/next-runtime` | 静态 manifest、workspace/npm resolution、Project Graph、配置组合、RuntimeEnvironment、source ownership、失效规划、HMR、Root 装配与 process restart 边界 |
| `@zhin.js/next-isolate` | 可选 Worker/child-process Plugin runtime、structured-clone RPC、drain 与 crash propagation |
| `@zhin.js/next-config-yaml` | 可选 YAML AST ConfigDocument adapter、乐观并发与原子文件事务 |
| `@zhin.js/next-feature-command` | 第一套标准 Feature provider 与 generation-scoped CommandIndex |
| `@zhin.js/next-feature-middleware` | `middlewares/**/*.ts`、确定性 onion compose 与 MiddlewareIndex |
| `@zhin.js/next-feature-component` | `components/**/*.ts|tsx`、owner override/ancestor fallback 与 ComponentIndex |
| `@zhin.js/next-feature-adapter` | `adapters/**/*.ts`、Endpoint lifecycle 与 generation handoff |
| `@zhin.js/next-im` | Snapshot-coherent inbound、Command dispatch、Component render 与统一 send pipeline |
| `@zhin.js/next-feature-tool` | `tools/*.ts`、`defineAgentTool()` 与 owner-scoped ToolIndex |
| `@zhin.js/next-feature-skill` | `skills/*/SKILL.md` immutable Skill projection |
| `@zhin.js/next-feature-agent` | `agents/*.agent.md` immutable Agent projection |
| `@zhin.js/next-feature-mcp` | `mcp/*.ts`、provider-neutral MCP client lifecycle |
| `@zhin.js/next-agent` | CapabilityIngress、owner-visible handles 与 snapshot-coherent turn lease |
| `@zhin.js/next-console-contract` | 零依赖 Page/Layout manifest、route、Navigation 与 Shell slot contract |
| `@zhin.js/next-feature-page` | `pages/*.ts|tsx`、Client Module artifact 边界与 PageIndex |
| `@zhin.js/next-feature-layout` | `pages/$nav.tsx`、`$footer.tsx` 与最近祖先 override chain |
| `@zhin.js/next-console` | route guard、permission filter、Plugin Navigation 与 snapshot-coherent Console catalog |
| `@zhin.js/next-client-build` | 可选 TypeScript AST metadata、content-hash ESM、artifact manifest 与生产 loader |
| `@zhin.js/next-cli` | Plugin monorepo 初始化、子包创建、inspect、build 与安全 publish plan |

每个包的完整契约与示例：

- [Kernel](kernel/README.md)
- [Feature Kit](feature-kit/README.md)
- [Command Feature](feature-command/README.md)
- [Middleware Feature](feature-middleware/README.md)
- [Component Feature](feature-component/README.md)
- [Adapter Feature](feature-adapter/README.md)
- [IM Runtime](im/README.md)
- [Tool Feature](feature-tool/README.md)
- [Skill Feature](feature-skill/README.md)
- [Agent Feature](feature-agent/README.md)
- [MCP Feature](feature-mcp/README.md)
- [Agent Runtime](agent/README.md)
- [Console Contract](console-contract/README.md)
- [Page Feature](feature-page/README.md)
- [Layout Feature](feature-layout/README.md)
- [Console Runtime](console/README.md)
- [Client Build Adapter](client-build/README.md)
- [Runtime](runtime/README.md)
- [Isolated Runtime](isolate/README.md)
- [YAML Config Adapter](config-yaml/README.md)
- [CLI](cli/README.md)

## 当前 Tracer Bullet

```text
package.json#zhin
  -> ProjectGraphService
  -> Plugin instance tree
  -> FeatureDiscovery(commands/components/middlewares/adapters)
  -> CapabilitySlot
  -> generation-scoped projections
  -> RootController commit
  -> SnapshotLease IM pipeline
  -> Endpoint send

AgentRuntime turn
  -> SnapshotLease
  -> Tool / Skill / Agent / MCP projections
  -> owner-visible CapabilityIngress
  -> scoped execution handles

Client Module artifact
  -> Page / Layout CapabilitySlot
  -> PageIndex / LayoutIndex
  -> ConsoleRuntime view lease
  -> route guard / Navigation / Layout fallback

TypeScript client source
  -> static definePage AST validation
  -> content-hash ESM + pages.manifest.json
  -> development builder / production manifest loader

Development ModuleRuntime watcher
  -> reverse importer closure
  -> SourceOwnershipIndex
  -> slot / subtree / process plan
  -> serialized generation transaction
  -> optional Resource handoff

Validated ConfigPatch
  -> YAML AST prepare
  -> shadow Plugin forest
  -> Resource handoff
  -> atomic file replace
  -> generation commit

Explicit EnvironmentLayers
  -> base / environment / Plugin overlays
  -> owner-scoped EnvStore Resource
  -> schema parse / expansion / redaction

runtime: isolated child
  -> prepare Worker / process
  -> quiesce + drain previous RPC
  -> activate candidate setup
  -> generation commit + open admission
```

默认 Runtime 只提供预编译 ESM adapter，不依赖 YAML、Vite、编译器或 watcher。YAML 配置和开发期 TS transform/watch 都由独立 adapter 提供，不能进入 `zhin.js` 默认生产依赖闭包。Graph inspect 在 import/setup 前校验 Runtime engine 与 Feature API semver contract。Command、Middleware、Component、Adapter 都是独立 Feature provider；Capability-only HMR 只重新 load 目标 Slot。Adapter projection 通过 generation handoff 在 commit 前停旧流、启动候选 transport，commit 后才开放 admission。child `plugin.ts` / `schema.json` 变化只影子装配对应 Plugin forest；manifest transaction 则局部处理 child 与 Feature mount 的新增、删除、移动。结构化 config patch 先整体验证，再按实际变化的 owner view 计算最浅 forest；可选 YAML adapter 把文件替换加入同一 generation handoff。以上路径都复用未变化的 Plugin Scope lifetime、重建全部 generation projections，并以完整 immutable snapshot 原子发布。Root setup/schema 与 package ABI 变化升级为受控 process restart；Feature provider 源码、未知 importer 与混合变更仍保守采用完整 shadow generation。

Page/Layout 只通过可选 `ModuleRuntime.loadClientModule()` 接收静态 artifact，Node 不执行 TSX。`@zhin.js/next-client-build` 提供独立 TypeScript AST/build adapter，TypeScript 是 peer，不进入 Runtime/Console 生产闭包。

`@zhin.js/next-isolate` 是同样可选的零第三方依赖 adapter。isolated child 的 config、RPC 和事件只经 structured clone；Host Scope 与普通 Feature 行为不会隐式跨边界。它提供故障/并发隔离，不宣称 OS 安全沙箱。

## Validate

```bash
pnpm exec vitest run packages/next
pnpm --filter '@zhin.js/next-*' build
pnpm --filter @zhin.js/next-im check:size
pnpm --filter @zhin.js/next-console check:size
```

CLI 发布默认运行 `pnpm publish --dry-run`。只有显式传入 `zhin-next publish --execute` 才执行真实发布，并且计划只包含当前 workspace package，不会操作 `node_modules` 中解析到的包。
