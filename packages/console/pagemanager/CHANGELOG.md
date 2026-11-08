# @zhin.js/pagemanager

## 1.1.24

### Patch Changes

- 8adce16: fix: post-refactor audit fixes across runtime, console blueprints, AI setup, and plugin stores

  - **Agent & Runtime**: adapt `DatabaseHost` models for `DatabaseEngagementJournal` after `DatabaseHost.start()` (`this[#db].select is not a function`), suppress deferred database warning in `seedInitialAiPlanIfEmpty`, lazy-load `@zhin.js/agent/runtime` in `agent-console.ts`, wrap `#receiveSideEvent` with `withEndpointEventPayload` and `captureInteraction`, select only `('id', 'timestamp')` in `SystemLogDatabaseTransport.prune()`, and surface clear install errors when optional AI/protocol packages are absent.
  - **Console Blueprints & RPC**: bundle `.ts` blueprint page entries via `esbuild` in `TypeScriptClientBuilder` so `spec`, `fields`, `dictionary`, `pollMs`, and `reviewSpec` are preserved in browser bundles; wire `CommentReviewSession` in `DeclarativePageView`; authorize `zhin.game` / `zhin.feature.game` in `plugin-console-rpc.ts`; forward `locale` in `entry-routes.ts`; pass `pluginId: entry.owner ?? entry.id` in `loadConsoleEntries.ts`.
  - **Plugin Store & Capabilities**: make `deriveStoreDisposer` idempotent in `@zhin.js/plugin-runtime`, guard nullish `carrier.resources`, handle `{ dispose }` return shapes in isolate `bootstrap.ts`, remove duplicate manual disposals in `answers`/`earthquake`, guard optional `projectLocaleToken` in `calendar`/`reminder`/`rss`/`lottery`, migrate `process-monitor` to `definePluginStore`, and align `capabilityGraph` declarations across plugins.
  - **Architectural Enhancements**:
    1. **Model Capability Baseline Catalog + Override Layer** (`@zhin.js/ai`, `@zhin.js/scaffold-wizard`, `@zhin.js/cli`): add `MODEL_CAPABILITY_CATALOG`, `inferModelCapabilities`, and `applyModelCapabilityDefaults` so built-in models carry accurate `input`/`streaming`/`toolCalling`/`thinking` baselines while preserving explicit `provider.capabilities` overrides.
    2. **Zero-Bundler Declarative Blueprint Protocol** (`@zhin.js/console-contract`, `@zhin.js/client`, `@zhin.js/pagemanager`): add JSON-serializable `DeclarativeValueExpr` operators (`$path`, `$count`, `$sum`, `$format`, `$map`, `$join`, `$coalesce`) evaluated identically across Web, IM Card, and CLI Panel projections, plus in-process `ts.transpileModule` synthesis (`synthesizePureBlueprintModule`) in `TypeScriptClientBuilder`.
    3. **Auto CapabilityGraph Convention Merge & Codegen** (`@zhin.js/plugin-runtime`, `@zhin.js/runtime`, `@zhin.js/cli`): add `mergePluginCapabilityGraph`, `scanConventionCapabilityFeatures` (auto-merged during `PluginScopeAssembler.setupTree`), and `zhin runtime codegen [dir] --write --json`.
    4. **Durable Turn Step Checkpointing** (`@zhin.js/agent`): add `TurnCheckpointStore` and `DatabaseTurnCheckpointStorage` (`agent_turn_checkpoints`) so multi-step tool turns interrupted mid-flight record completed `(assistant[toolCall] -> toolResult[])` rounds and resume from the last committed `toolResult` boundary on retry or `"继续"`/`"continue"`.
  - **UI Component System & Developer Preview Workbench** (`@zhin.js/client`, `@zhin.js/components`, `@zhin.js/cli`, `create-zhin-app`):
    - Expand `@zhin.js/client/ui` and `@zhin.js/components` with unified design tokens (`UI_DESIGN_TOKENS`), option icons (`RadioGroup`/`CheckboxGroup`), custom chart images/logos (`BarChart`/`Sparkline`/`DonutChart`/`GaugeBar`), batch table selection & sticky columns (`DataTable`), responsive viewport presets (`CardCanvas`), and shared layout/display primitives.
    - Add `zhin preview [dir]` command in `@zhin.js/cli` (and `"preview": "zhin preview"` in `create-zhin-app`) for zero-build live SSE component & page blueprint previewing, interactive `previewProps` JSON editing, canvas width/background presets, and box-model outline debugging.
  - **IM Chat Controlled Restart & Post-Restart Channel Receipt** (`@zhin.js/cli`):
    - Add `installRestartHost` (`restart` / `重启` / `reboot` command for Bot owners) and `deliverPendingRestartReceipt` so owners can trigger a supervised process restart from any IM conversation and automatically receive the restart completion summary in the originating channel once the endpoint reconnects.
    - Ignore `SIGHUP` in `NativeTypeScriptSupervisor` when running in `--daemon` mode.

- Updated dependencies [8adce16]
  - @zhin.js/console-contract@1.1.5
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/layout@1.1.17
  - @zhin.js/page@1.1.17
  - @zhin.js/contract@1.1.22

## 1.1.23

### Patch Changes

- cbf1fb1: Unify Console page blueprints (`definePageBlueprint`, `defineAdapterPage`, `defineCommentReviewPage`, `projectBlueprintToImCard`, `projectBlueprintToCliPanel`) into `@zhin.js/console-contract` and `@zhin.js/page`, add zero-esbuild pure Blueprint synthesis + static client bundle mounting to `@zhin.js/pagemanager`, remove `@zhin.js/client` (React 19) and `.tsx` from all 30 server-side plugins and adapters (including `bilibili` and `juejin`), and remove legacy Era-1 Koa `PageManager` code.
- Updated dependencies [cbf1fb1]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/console-contract@1.1.4
  - @zhin.js/page@1.1.16
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/layout@1.1.16
  - @zhin.js/contract@1.1.21

## 1.1.22

### Patch Changes

- fed2c27: Upgrade Console Host, Plugin Pages compiler/DX, and `/sandbox` workbench:

  - Populate React 19, `react-dom/client`, and `react-router-dom` named exports and standalone ESM fallback in `@zhin.js/pagemanager`.
  - Re-export `definePage` from `@zhin.js/page`, forward all `PageMetadata` fields (`group`, `order`, `parent`, `fullWidth`, `titleI18n`), and inject `{ pluginId, owner, localName, route, title }` props into page components.
  - Add `definePluginConsoleRpc.withConfig<TConfig>()` and `@zhin.js/client` `createDeclarativePage` helper.
  - Upgrade local Console shell (`page-renderer.ts`), live `log:entry` SSE broadcasts, and `/sandbox` simulated sender identity/role switching and rich segment rendering.

- bc6ccb1: Deep audit bug fixes and 7 architectural improvements:
  - Sink Agent Turn ingress pipeline from `@zhin.js/cli` into `@zhin.js/agent/runtime` (`plugin-runtime/ingress/`) and decompose `ingress-route.ts` into modular pipeline stages.
  - Bind Session State Plane (`JsxButtonRegistry`, `InteractionRuntime`, `RuntimeInteractiveRouter`) to `PluginIncarnationRef` so active buttons and interactions survive unrelated-plugin HMR while expiring when the owning plugin reloads, and support per-conversation fallback numbering (`numberingScope: 'conversation'`).
  - Establish `conversation_events` as the canonical message SSOT and reference `conversation_event_id`, `conversation_key`, `platform_message_id`, and `message_key` in `agent_messages` (`AGENT_MESSAGE_QUERY_VERSION = 2`), threading `conversationSequence` across inbound and outbound delivery receipts.
  - Push down `DatabaseContextRepository` and `DatabaseScheduleJobStorage` full-session/full-table memory scans to indexed SQL queries.
  - Add kernel-level inbound `replyTo` and `mentioned` auto-promotion (`promoteInboundMessagePayload`) plus reusable `InboundDeduper` and `TtlLookupCache` primitives in `@zhin.js/adapter`.
  - Add `MiddlewareContext.dispatch` (`InboundDispatchSummary`) and `onAfterDispatch` hooks for `after-dispatch` middlewares, and support incremental rendering of in-place `envelope.payload` array mutations in `OutboundDeliveryRuntime`.
  - Unify `HistoryWindowTracker` and `AgentCompactionRuntime` token/message budgets (`resolveUnifiedHistoryAndCompactionBudget`).
  - Fix schema validation, database transaction connection cleanup and SQLite WAL mode, schedule timer wheel head-of-line blocking, security policy bash read paths and subagent guard propagation, group merge window permission carrier handoff, micro-compact namespaced tool matching, and WebSocket force-close / inbound segment mapping across adapters.
- 72b5a12: Improve plugin authoring DX, operator/CLI onboarding, IM/AI chat UX, CI reliability, and documentation narrative across the workspace:

  - **Plugin Authoring DX**:
    - Compare `mtimeMs` between `src/*.ts` and compiled `lib/*.js` in native TypeScript development runtime so stale `lib/` build outputs never shadow newer source edits.
    - Support `@zhin.js/schema` `Schema.object()` directly in `defineAgentTool` (`inputSchema`) with full TypeScript type inference and default value population.
    - Allow equivalent `definePlugin({ config })` and `schema.json` to coexist without throwing `PluginConfigSourceConflictError`.
    - Add `.withConfig<TConfig>()` helpers to `defineMiddleware`, `defineHandler`, `defineComponent`, `defineSchedule`, and `defineMcp`, and expose `has(token)` on `CapabilityContext`.
    - Enhance `@zhin.js/testing` with `createFakeInteraction`, automatic positional/option default parsing in `runCommand`, and `$sendTo` / `$replyTo*` helpers on `FakeMessage`.
  - **CLI, Wizard & Local Sandbox UX**:
    - Automatically seed `ai.plan.yml` into the Host database on first startup when the inference graph is empty.
    - Add domestic and aggregator AI provider presets (`qwen` / DashScope, `siliconflow`, `volcengine`, `minimax`, `openrouter`) and automatic capability pre-filling in `@zhin.js/scaffold-wizard`.
    - Add `/sandbox?token=...` query bootstrap and header token input UI for zero-DevTools local sandbox debugging, plus `zhin start` alias and unset `${ENV_VAR}` config warnings.
  - **IM Command, Interactive Fallback & AI Chat UX**:
    - Reset per-conversation fallback button numbering once previous interactive prompts finish and ignore TTL-expired bare numeric messages in group chats.
    - Deduplicate numbered option lists in text-fallback `user-interaction` prompts.
    - Support out-of-the-box `菜单` / `帮助` / `help` / `menu` aliases, flattened root command menus (when ≤ 8 commands), `-h` help flag, distinct missing-parameter diagnostics, and `@Bot /cmd` mention stripping in group chats.
    - Preserve `<header>` / `<footer>` in HTML text fallback, format Markdown tables cleanly in plain-text fallback, bind tool approval prompts to master senders, and lower turn progress feedback interval to 15s.

- Updated dependencies [fed2c27]
  - @zhin.js/page@1.1.15
  - @zhin.js/contract@1.1.20
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/layout@1.1.15

## 1.1.21

### Patch Changes

- Updated dependencies [299863a]
- Updated dependencies [4fe49b5]
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/layout@1.1.14
  - @zhin.js/page@1.1.14
  - @zhin.js/contract@1.1.19

## 1.1.20

### Patch Changes

- Updated dependencies [976886c]
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/contract@1.1.18
  - @zhin.js/layout@1.1.13
  - @zhin.js/page@1.1.13

## 1.1.19

### Patch Changes

- 5e878ba: fix(console): match Page/Layout projections by `$projection` brand instead of prototype identity, so Console topology no longer comes back empty when the runtime loads feature packages with a `?zhin-generation` query (Sandbox and other plugin pages were missing).
- Updated dependencies [5e878ba]
  - @zhin.js/page@1.1.12
  - @zhin.js/layout@1.1.12

## 1.1.18

### Patch Changes

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [2c3610a]
  - @zhin.js/plugin-runtime@1.1.18
  - @zhin.js/layout@1.1.11
  - @zhin.js/page@1.1.11
  - @zhin.js/contract@1.1.17

## 1.1.17

### Patch Changes

- @zhin.js/contract@1.1.16

## 1.1.16

### Patch Changes

- @zhin.js/contract@1.1.15

## 1.1.15

### Patch Changes

- 658a5fb: Console access is now per token. Entries in `http.tokens` can set `permissions` and `roles`. The Console filters navigation and page lists (`/entries`, `/console/api/pages`, `/console/api/topology`, page shells and the `pages:list` RPC) by the caller's token. Plugin `status` RPC is open to a non-admin token that holds the bound page's requirements. Full-scope tokens, and Hosts with no tokens configured, still see everything. Page lists are no longer evaluated with empty access, so pages that declare `requiredPermissions` are now visible to the users allowed to see them.
- af29996: 为 Page 元数据增加可选 titleI18n，在页面目录、导航与 Console 客户端注册链路中保留显式标题翻译。Sandbox 页面提供英文导航标题，缺少对应语言时保留插件原题，不修改路由或访问规则。
- b8e594e: Plugins can register Console status and limited actions with `definePluginConsoleRpc` and `pluginConsoleRpcToken`. Pages call them as `plugin.<pluginId>.status` and `plugin.<pluginId>.<action>` through the existing Console request, using `pluginRpc()` from `@zhin.js/client`. Access follows the bound page's `requiredPermissions` and `requiredRoles`. Actions need the full-scope token, and the demo token can read status only when the plugin opts in. Input, output and run time are bounded, and raw errors never reach the page.
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [658a5fb]
- Updated dependencies [144a17b]
- Updated dependencies [af29996]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/console-contract@1.1.3
  - @zhin.js/page@1.1.10
  - @zhin.js/contract@1.1.14
  - @zhin.js/layout@1.1.10

## 1.1.14

### Patch Changes

- @zhin.js/contract@1.1.13

## 1.1.13

### Patch Changes

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/contract@1.1.12
  - @zhin.js/layout@1.1.9
  - @zhin.js/page@1.1.9

## 1.1.12

### Patch Changes

- @zhin.js/contract@1.1.11

## 1.1.11

### Patch Changes

- a383380: 修复 source map：这些包之前的 `.js.map` / `.d.ts.map` 指向没有发布的 `src/`，调试和"跳转到定义"都找不到源码。现在 `.js.map` 内联了源码（`inlineSources`），也不再生成指不到源码的 `.d.ts.map`。运行时行为不变。

  预告：下一个大版本会移除发布包里冗余的 `.ts` 源码（很多包里的 `src/**/*.ts`，以及插件约定目录里与 `index.js` 并排的 `index.ts`），本次不做改动。深导入 `.ts` 文件的代码请改用包的 `exports` 入口，详见根目录 `CHANGELOG.md`。

  Source maps now embed their sources (`inlineSources`); dangling `.d.ts.map` files are no longer emitted. Heads-up: redundant published `.ts` sources will be removed in the next major. Switch any deep `.ts` imports to the package's `exports` entry.

  - @zhin.js/layout@1.1.8
  - @zhin.js/page@1.1.8
  - @zhin.js/contract@1.1.10

## 1.1.10

### Patch Changes

- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/plugin-runtime@1.1.15
  - @zhin.js/contract@1.1.9
  - @zhin.js/layout@1.1.7
  - @zhin.js/page@1.1.7

## 1.1.9

### Patch Changes

- @zhin.js/contract@1.1.8

## 1.1.8

### Patch Changes

- @zhin.js/contract@1.1.7

## 1.1.7

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/console-contract@1.1.2
  - @zhin.js/contract@1.1.6
  - @zhin.js/layout@1.1.6
  - @zhin.js/page@1.1.6
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.6

### Patch Changes

- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/contract@1.1.5
  - @zhin.js/layout@1.1.5
  - @zhin.js/page@1.1.5

## 1.1.5

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/layout@1.1.4
  - @zhin.js/page@1.1.4
  - @zhin.js/contract@1.1.4

## 1.1.4

### Patch Changes

- b9b3953: Load the optional TypeScript compiler only when Page/Layout source metadata is parsed. Allow pure JavaScript CLI projects without client pages to start without TypeScript, and report an explicit optional-peer installation error when compilation is requested.
  - @zhin.js/contract@1.1.3

## 1.1.3

### Patch Changes

- f12e39a: Track each loaded Feature entry's transitive local imports so edits to imported helper files reload only the affected capabilities, including helpers outside the entry directory, while refreshing the complete ESM import closure. Cache clean dependency graphs, resolve package imports with ESM conditions, handle `.mts` and `.cts` entries consistently, keep CommonJS require closures on the process-restart boundary, and discard removed-entry mappings only after a generation commits.
- Updated dependencies [fa542a2]
  - @zhin.js/console-contract@1.1.1
  - @zhin.js/layout@1.1.3
  - @zhin.js/page@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/layout@1.1.2
  - @zhin.js/page@1.1.2
  - @zhin.js/contract@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [3d42fc9]
- Updated dependencies [f474b1d]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/page@1.1.1
  - @zhin.js/contract@1.1.1
  - @zhin.js/layout@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/console-contract@1.1.0
  - @zhin.js/contract@1.1.0
  - @zhin.js/layout@1.1.0
  - @zhin.js/page@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 2.0.23

### Patch Changes

- @zhin.js/contract@1.0.19

## 2.0.22

### Patch Changes

- @zhin.js/contract@1.0.18

## 2.0.21

### Patch Changes

- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/layout@1.0.13
  - @zhin.js/page@1.0.13
  - @zhin.js/contract@1.0.17

## 2.0.20

### Patch Changes

- @zhin.js/contract@1.0.16

## 2.0.19

### Patch Changes

- Updated dependencies [67ef8c4]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/layout@1.0.12
  - @zhin.js/page@1.0.12
  - @zhin.js/contract@1.0.15

## 2.0.18

### Patch Changes

- @zhin.js/contract@1.0.14

## 2.0.17

### Patch Changes

- @zhin.js/layout@1.0.11
- @zhin.js/page@1.0.11

## 2.0.16

### Patch Changes

- @zhin.js/contract@1.0.13
- @zhin.js/layout@1.0.10
- @zhin.js/page@1.0.10

## 2.0.15

### Patch Changes

- 63253bb: Restrict Root consumers to the read-only `SnapshotReader` lease interface and
  remove public `RootRuntime.controller` access. Generation commit, transaction,
  close, and stop authority now remain inside the Root lifecycle.

  Close Root admission when rollback cleanup or retired-generation disposal can
  no longer prove lifecycle integrity. Existing leases may drain, but new
  operations and generation transactions fail closed until the Process Host
  stops the Root.

  Bind externally driven capability resources to lifecycle-owned generation admission gates.
  Adapter candidates can establish Endpoint connections during readiness while their IM ingress
  remains invisible; snapshot commit atomically retires the old ingress and publishes the new one,
  without closing the old Endpoint before the transaction succeeds.
  Admitted HTTP, WebSocket, IM, isolated-RPC, Endpoint control, and Endpoint management operations
  now retain their exact generation until settlement instead of escaping with a live object.

  Remove inert unconfigured Endpoints and deferred soft-start. Configured Endpoint creation,
  connection readiness, and local admission are required generation prerequisites; any failure
  disposes the complete candidate set and leaves the previous generation serving traffic.

  Move the HTTP listener to Process Host ownership. Generation scopes now receive only an
  `HttpHost` routing port (without `listen`/`close` authority), and HTTP/WS registrations are tagged
  with generation admission so candidate routes cannot shadow committed routes before publish.

  Remove the fallible post-commit `openNext` phase and all pre-commit old-generation
  quiesce/resume hooks. Handoff now performs candidate readiness and reversible candidate cleanup
  only; the previous generation remains untouched until the single synchronous snapshot/admission
  publish point, then drains through its existing leases.
  Candidate setup, Feature projection, Endpoint readiness, MCP connection, isolation activation,
  database activation, and config commit now receive the Root transaction `AbortSignal`; Root Stop
  fails closed and awaits candidate cancellation cleanup.

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/layout@1.0.9
  - @zhin.js/page@1.0.9
  - @zhin.js/contract@1.0.12

## 2.0.14

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/layout@1.0.8
  - @zhin.js/page@1.0.8
  - @zhin.js/contract@1.0.11

## 2.0.13

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/contract@1.0.10
  - @zhin.js/layout@1.0.7
  - @zhin.js/page@1.0.7
  - @zhin.js/console-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.4

## 2.0.12

### Patch Changes

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/layout@1.0.6
  - @zhin.js/page@1.0.6

## 2.0.11

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/layout@1.0.5
  - @zhin.js/page@1.0.5

## 2.0.10

### Patch Changes

- @zhin.js/contract@1.0.9

## 2.0.9

### Patch Changes

- @zhin.js/contract@1.0.8

## 2.0.8

### Patch Changes

- @zhin.js/contract@1.0.7

## 2.0.7

### Patch Changes

- @zhin.js/layout@1.0.4
- @zhin.js/page@1.0.4

## 2.0.6

### Patch Changes

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/layout@1.0.3
  - @zhin.js/page@1.0.3
  - @zhin.js/contract@1.0.6

## 2.0.5

### Patch Changes

- e5c84ed: Adapter 多账号：插件实例 config 支持 `endpoints: [{name, ...覆盖}]` 数组，`expandEndpointConfigs` 将一个实例展开为多个 endpoint record（id 为 `<slotId>~<name>`，顶层字段共享、逐项覆盖），替代多 `instanceKey` 方案；Console `/api/plugins` 收敛为一个插件卡片 + 多 endpoint。icqq / qq schema 与 README 补 `endpoints` 配置。

  Plugin Runtime Console Host：补 `/esm/*` React/router ESM 代理路由（legacy `consoleApiRouter` 对齐），TypeScriptClientBuilder 裸导入改写为 `/esm/<enc>.mjs`。

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/layout@1.0.2
  - @zhin.js/page@1.0.2
  - @zhin.js/contract@1.0.5

## 2.0.4

### Patch Changes

- cc5c94d: 约定式插件运行时迁移（breaking）：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等）。

  - 新增约定式运行时包：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`（首版 1.0.0 走 init-publish，不在本 changeset 内 bump）。
  - 全部 20 个平台适配器改为约定式 `defineAdapter`，旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook/wss、satori webhook、kook webhook、qq webhook/middleware 等 slice 1 推迟的连接模式已补齐。
  - 游戏 / 工具 / 服务插件同步迁移到约定目录结构。
  - CLI 增加 plugin-runtime host installer（http/database/outbound/schedule/console 等）。

  后续加固（同批）：

  - CLI：`zhin runtime start --daemon`（pidfile/崩溃拉起/风暴保护），orphan watchdog 防僵尸进程；legacy `zhin dev` / `zhin start` 已移除（含 `zhin restart`），`zhin stop` 兼容新 daemon。
  - 安全：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；`splitCompoundCommand` 引号感知、`extractCommandName` 去引号堵绕过。
  - 日志：Logger 双堆栈修复、本地时区、`getLogger` 挂树（`setLevel` 递归生效）、第三方库（log4js/discord）桥接、启动人读总结。
  - 结构：`plugins/games/shared` 迁为 `packages/game-kit`（`@zhin.js/game-kit`）；死目录 `plugins/adapters/common` 删除。
  - 脚手架：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态（minimal-bot 同构，新配置格式）。
  - Console：endpoint.list 真实名称与 phase、schema:get-all 按 instanceKey 映射、db:\* 接 DatabaseHost。

  注：按仓库发布惯例（见 1bb345dd2），本次 breaking 迁移统一使用 patch，避免 zhin.js 5.0 级联。

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/layout@1.0.1
  - @zhin.js/page@1.0.1
  - @zhin.js/contract@1.0.4

## 2.0.3

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/contract@1.0.3

## 2.0.2

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
  - @zhin.js/contract@1.0.2

## 2.0.1

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/contract@1.0.1

## 1.0.4

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/console-types@0.1.5

## 1.0.3

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [f19d2e0]
  - @zhin.js/console-types@0.1.4

## 1.0.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console-types@0.1.3

## 1.0.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console-types@0.1.2

## 1.0.0

### Major Changes

- Remote Console 与 Host 分离：zhin 主仓仅保留 Console **API**，静态 UI 迁至独立仓库 [zhinjs/console](https://github.com/zhinjs/console)。

  ### @zhin.js/console-core (major)

  - 移除 `./browser` 导出；包仅含 Node 侧 PageManager、`/entries`、`/@dev`、`/esm` 打包管线。
  - 不再依赖 `console-app` 内置壳；`registerBuiltinAppShellServer` 已删除。

  ### @zhin.js/client (minor)

  - 合并原 `@zhin.js/console-core/browser` 能力：`loadConsoleEntries`、`apiFetch`、`getApiBase`、`createRegistryStore` 等。
  - Remote Console UI 应依赖本包 + `zhin-console` 静态站，勿再 `import from '@zhin.js/console-core/browser'`。

  ### @zhin.js/console (major)

  - Host 默认 **api_only**（`serveClientHost: false`），不再捆绑 Farm 静态页。
  - 移除对 `@zhin.js/console-app` 的依赖；`PageManager` 的 esbuild 解析根目录改为机器人项目根（`ZHIN_PROJECT_ROOT` / `cwd`）。
  - 删除 `plugins/services/console/client` 内置 UI 源码（已迁至 zhin-console）。

## 0.1.1

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/console-types@0.1.1
