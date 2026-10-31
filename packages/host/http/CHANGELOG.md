# @zhin.js/host-http

## 1.1.12

### Patch Changes

- 2c3610a: Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

  Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

  Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

  Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

  Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

- 2c3610a: Add owner-scoped personal AI Sessions and a closed model policy hierarchy. Compile legacy providers and bindings into immutable, revision-leased connection/model/preset invocations while keeping Agent tool authority separate.

  Provide authenticated personal model management, encrypted Host-private credentials, public HTTPS transport with DNS pinning and same-origin redirects, and persistent per-Session model selection. Deployment tasks and summaries retain deployment model authority. Preserve legacy history and configured perception fallback chains. Keep every chat turn on its selected model, including legacy configuration, while retaining same-model retries.

  Extend trusted Host generation leases to resolve Root-private resources without publishing them in snapshots or child Plugin Scopes.

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [2c3610a]
  - @zhin.js/plugin-runtime@1.1.18

## 1.1.11

### Patch Changes

- 1ca669a: Read complete retained user-message text on demand through the existing session-tree runtime and `GET /api/agent/sessions/:key/message`. Bind each read to the tree's session ID, reject cross-session/non-user messages, and return text without image payloads. Keep tree previews unchanged and report older runtimes without message reading as unsupported.

## 1.1.10

### Patch Changes

- f3b7c9f: 新增 Console RPC `config:patch`：按路径写入配置，供面向普通用户的简单页面使用（#970）。

  - 路径白名单：带 `instanceKey` 时只能写该插件实例自己的配置块，以及插件 `schema.json` 根部 `x-zhin-config.patchPaths` 声明的 Host 子路径；省略时只能写 `HOST_CONFIG_PATCH_PATHS`（目前为 `ai.trigger.ambient`）。
  - `expectedRevision` 必填；文件已变时返回 `status: 'conflict'` 和最新值，不覆盖。
  - 写入前按 schema 校验每个被改动的配置块；成功响应带 `restartRequired`，`config:updated` 事件新增 `paths` 与 `revision` 字段。
  - `@zhin.js/client` 新增 `patchConfig()`；`@zhin.js/service-typesafe` 声明可写 `ai.decisions`。

  纯新增能力：`config:set`、`config:replace-source` 与 YAML 编辑器行为不变，无需迁移。`config:patch` 只接受 full scope Token，Demo 部署不可用。

- 658a5fb: Console access is now per token. Entries in `http.tokens` can set `permissions` and `roles`. The Console filters navigation and page lists (`/entries`, `/console/api/pages`, `/console/api/topology`, page shells and the `pages:list` RPC) by the caller's token. Plugin `status` RPC is open to a non-admin token that holds the bound page's requirements. Full-scope tokens, and Hosts with no tokens configured, still see everything. Page lists are no longer evaluated with empty access, so pages that declare `requiredPermissions` are now visible to the users allowed to see them.
- 144a17b: Console 令牌新增 `scope: user`（与 `demo` 等价，表示普通用户）。普通用户现在可以执行插件 Console 动作，前提是动作自己声明了 `requiredPermissions` 或 `requiredRoles`，并且令牌全部满足；没有声明要求的动作仍然只给管理员。用户仍然就是 `zhin.config.yml` 里的 `http.tokens` 条目。
- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- Updated dependencies [0fc0219]
- Updated dependencies [f3b7c9f]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/console-protocol@1.1.12

## 1.1.9

### Patch Changes

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16

## 1.1.8

### Patch Changes

- Updated dependencies [d13b1d7]
- Updated dependencies [1971e0c]
  - @zhin.js/console-protocol@1.1.11

## 1.1.7

### Patch Changes

- 2b4d6dc: 为已保存的插件配置提供只读字段来源与当前代一致性解释。复用同一次文件/运行代观察，仅返回有界 metadata；敏感字段、环境引用和不能证明的来源保持隐藏或未知。配置解释要求完整权限，不开放给 demo，也不执行应用或发送操作。
- Updated dependencies [7edd04c]
- Updated dependencies [2b4d6dc]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/console-protocol@1.1.10
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.6

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/console-protocol@1.1.9
  - @zhin.js/host-http-contract@1.1.1
  - @zhin.js/plugin-runtime@1.1.14
  - @zhin.js/schedule@1.1.3
  - @zhin.js/logger@1.1.2

## 1.1.5

### Patch Changes

- 4778587: 补齐 Console 安装配置闭环所需的精确配置路径、端点身份、平台就绪与验证计划失效语义，并保存历史消息的方向及实际投递诊断。

  修复真实 ICQQ 入站目标保存了插件 owner 而非平台标识、导致提醒投递被身份校验拒绝的问题；无关插件配置变更保留原有适配器连接。

  保证候选事件在当前代快照发布后准入，并避免安装过程中依赖文件变动提前中断插件管理操作。

  明确 Adapter/MCP 客户端创建仅提供所属 owner 的配置与资源，跨 Feature 查询由当前 operation 上下文负责；入站诊断记录接收时刻，避免慢指令的回复在历史中先于指令。

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/console-protocol@1.1.8

## 1.1.4

### Patch Changes

- Updated dependencies [badcc1f]
  - @zhin.js/plugin-runtime@1.1.12

## 1.1.3

### Patch Changes

- b9b3953: Fix adapter connection races, transport health reporting, candidate rollback and delivery acknowledgement boundaries. Separate generation admission from locally observed connectivity, reject unconfirmed message receipts, and mark uncertain delivery results without recommending automatic replay.

  Class and compact endpoints should expose a `transportState` getter to report physical connection or local listener health. Unobserved endpoints now report an unknown transport and remain offline in diagnostics. Platform stability tiers remain unchanged until real account acceptance evidence is available.

- b9b3953: Return HTTP 403 for a valid demo token that lacks route authority, reserving 401 for invalid authentication so Console does not discard a valid credential on a permission denial. Keep the restricted demo REST surface unchanged. Raw config:get, config:get-all and config:get-source now require full scope because persisted configuration may contain secrets; demo is a limited inspection scope, not a general read-only editor account.
- b9b3953: Add page/pageSize history retrieval, stable timestamp/id ordering, literal case-insensitive query and exact-source filters to Console logs. Existing limit calls retain their array response, with real filtered totals and stable row IDs. Source counts cover the full level/query result independently of the selected source or page. Literal queries match actual retained rows on the Host because the database LIKE operator does not provide a portable escape contract.
- b9b3953: Make HTTP Host close terminal, share concurrent listen operations, and wait for a pending bind before closing to prevent late orphan listeners. Preserve canonical A2A v1 JSON message content, task/card/SSE serialization and standard REST-relative paths while retaining the existing /v1 aliases.
- b9b3953: Resolve Console project file paths through their real filesystem targets. Deny symlink escapes, blocked targets and dangling links for reading, writing, tree discovery and environment file inventory, while retaining allowed internal links.
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/console-protocol@1.1.7
  - @zhin.js/schedule@1.1.2

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11

## 1.1.1

### Patch Changes

- 244e475: Add a shared CLI and Console plugin-management transaction for install, update,
  uninstall, configuration validation, lifecycle control, diagnostics, Marketplace
  discovery, and Endpoint connectivity checks. Console mutations use revision checks,
  exact-version plans, post-operation verification, and recoverable manifest and
  lockfile snapshots.
- 103f2c3: Document the canonical Workroom Journal, Projection Outbox, and Extended Console RPC module entries, and add a repository gate that prevents external deep imports or restoration of their removed flat source entries.
- cd2a888: Scope the Console marketplace registry cache to each Host route registration so Hosts with different registries cannot reuse one another's plugin data. Concurrent registry reads within one Host now share the same in-flight request.
- 2dbbc15: Classify watched Root configuration changes by their actual Host and Plugin projections, reload only affected Plugin subtrees, and request a process restart for Host configuration changes. Reload project dotenv layers as Runtime inputs so environment references are re-expanded without mutating global process state.
- 6b70e46: Remove deprecated runtime authoring aliases instead of carrying two names for one concept. AI setup now accepts only `agentProvider` and exposes `resolveAgentProviderFromConfig`, HTTP Host consumers use the canonical Console endpoint contract directly, and activity feedback resolution goes through `ActivityFeedbackPolicy`.
- baef56b: Require canonical dot-named Console RPCs with top-level camelCase request and response payloads, and remove legacy aliases and normalization paths.
- da0a8e3: Split extended Console RPC into a thin protocol dispatcher plus cohesive schedule, inbox, login, Endpoint-management, and Workroom control modules. Keep request parsing and generation-leased Endpoint execution behind explicit internal helpers while preserving the package-root API and wire protocol.
- 507d602: Make the Root `ConfigFileDocument` the sole configuration authority for Runtime, Endpoint commands, and Console. Console source editing now preserves the active YAML or JSON format, uses optimistic revision checks, returns one consistent source-and-key snapshot, and exposes canonical `config:get-source` / `config:replace-source` RPCs without the former YAML-only compatibility names.
- Updated dependencies [13f7301]
- Updated dependencies [244e475]
- Updated dependencies [ef92a6d]
- Updated dependencies [9110ab8]
- Updated dependencies [3d42fc9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [baef56b]
- Updated dependencies [65d0391]
- Updated dependencies [cf83528]
- Updated dependencies [507d602]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/console-protocol@1.1.6
  - @zhin.js/logger@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/console-protocol@1.1.5
  - @zhin.js/host-http-contract@1.1.0
  - @zhin.js/logger@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 1.0.17

### Patch Changes

- a728a20: Expose the token-bound Console principal for safe Workroom sponsor initialization, generate the missing governed Console disclosure sink, use one canonical Catalog binding digest, and renew stale Project disclosure authorities after Catalog or Sponsor changes.

## 1.0.16

### Patch Changes

- fcbff21: Add durable Console plugin lifecycle controls and support secure multi-listener HTTP, HTTPS, and WebSocket hosts.

## 1.0.15

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.

## 1.0.14

### Patch Changes

- a5ee497: Return a renderable empty Agent session tree for canonical channel conversations that have not started an AI conversation yet, while preserving 404 for unknown keys and strict branch mutations.
- ba7e17a: Prevent concurrent Workroom discussions from losing their Orchestrator handoff, route those handoffs before ordinary commands, resolve cross-Endpoint projection replies through their canonical message reference, respect the global AI trigger switch, and reject unknown canonical Console session keys when the durable inbox is available.

## 1.0.13

### Patch Changes

- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/logger@1.0.77

## 1.0.12

### Patch Changes

- b10d058: Preserve standard SSE event metadata, expose typed resumable Console event history, recover missed events before reconnecting the live stream, and allow durable unread notices to be rebuilt after a history gap.
- Updated dependencies [b10d058]
- Updated dependencies [f2c532f]
  - @zhin.js/console-protocol@1.1.4

## 1.0.11

### Patch Changes

- d336a3f: Remove the process-global Assistant, legacy orchestration, and session-tree registries. Host and Console operations resolve narrow projections exclusively from the request's generation-owned `AgentHostPort`; the Workroom major changeset removes `OrchestrationService` itself rather than retaining another mutable command authority. Shadow generations can no longer publish operational state before commit, retired generations cannot leak back into service, and Console no longer receives concrete mutable repositories, engines, ingress objects, or orchestration services.

  Also remove the unused process-global bootstrap gate, connection authorization queue, session agent-state store, and the empty `@zhin.js/agent/connection` compatibility subpath. The inert state-authoring contract is removed in full: `defineState`, its public definition/discovery types, `DiscoveredPluginAgentSurface.states`, `AgentSurfacePluginInfo.states`, and `agent/state/*` discovery/reporting no longer exist. These experimental APIs had no production authority or lifecycle owner; connection authorization and durable state must be supplied by explicit generation-owned ports instead.

  Remove the equally inert `defineDynamic` contract, `agent/dynamic.ts` discovery, process-global resolver registry, and per-turn prompt scratch field. Although files were reported as discovered, no production composition path ever registered them. Dynamic turn policy must be modeled as an explicit generation-owned projection rather than a latest-live module registry.

  Make the Schedule `JobWorker` the sole owner of a narrow private `ScheduleExecutionQueue`, removing the public generic orchestrator `TaskQueue`, module-level latest-generation lookup, implicit queue/timer construction fallback, speculative DAG/priority/listener APIs, and the direct-execution bypass. Queue timeout and disposal now propagate cancellation through `TaskExecutor` into the Schedule Turn, retain their concurrency/lifecycle slot until the real operation settles, settle every queued waiter, and reject use after disposal. Remove the deprecated `AssistantJob*`, `createAssistantJobStore`, `getAssistantJobsPath`, `legacyDualWrite`, and inert `jobsFile` configuration surfaces; Schedule naming and the fixed `schedule-jobs.json` path are now the only contracts.

- 5969c5b: Drop ICQQ unified_inbox dual-write for request/notice; Console request.list prefers EndpointManagement.listRequests, and approval stays on $approve / management.
- 5969c5b: Wire ICQQ login challenges (QR / slider / SMS / auth) through LoginAssist so pending tasks survive Console refresh; add login.list/submit/cancel RPC and TTY stdin consumer.
- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 985fa22: Remove `ai.workrooms` as a restart-bound configuration surface. Workroom definitions now live in the persistent Workroom Catalog, are validated against the exact active Plugin Runtime generation, and can be managed through the Console without rewriting process configuration.

  Remove the `AgentOrchestrator` and `ResourceHub` compatibility exports in favor of `AgentResourceHub`. The renamed resource hub is only the generation-scoped registry for Tool, Skill, SubAgent, MCP, and Hook capabilities; durable Workroom orchestration and Run/Task/Assignment state remain exclusively owned by the Workroom Kernel and its typed ports.

  Route durable IM ingress through canonical Interaction Space bindings before commands or ordinary chat Agents. Workroom and Sponsor spaces produce content-free Project Inbox or Task Input proposals; they never fall through to the ordinary chat Agent authority path.

  Add the authenticated Remote A2A callback host and the first durable outbound dispatch admission boundary. Remote dispatches preregister exact Assignment authority before transport, bind delivered remote task/context receipts before accepting callbacks, and recover crash windows without resending an already-bound dispatch. Missing or uncertain transport outcomes remain `reconcile_required` and cannot complete a Task.

  Persist each Workroom member's Assignment locality in the Catalog. Omitted routes retain the legacy local meaning; remote routes name one exact A2A endpoint and remain deterministic when several endpoint transports are enabled. Catalog/Profile/Grant authority is rechecked before either local or remote claim, so local and remote providers can coexist without first-wins or lexicographic routing.

  Replace the legacy file-backed Workroom Journal array format with content-addressed immutable v3 segments and database envelopes. The v3 schema uses an event-specific closed payload schema, stores only opaque control references beside governed payload receipts, and rejects unknown future fields before publication. Existing `.zhin/workroom-journal` data and database rows—including the blacklist-era v2 format—must be exported and migrated offline before starting this release; the runtime deliberately rejects legacy records instead of guessing their schema or silently upgrading historical `completed` work into accepted Project state.

  Replace arbitrary Effect Sponsor decision `reason` text with the closed v2 `reasonCode` contract. An exact pending-Intent resubmission first publishes a content-free, digest-bound quarantine/supersession receipt, durably replaces the legacy plaintext slot with that tombstone, and then publishes to a dedicated v2 slot. Partial migrations fail closed and resume idempotently after restart, while existing v2 records in the former slot remain replay-compatible. Human rationale must use a governed payload surface and is never persisted in the content-free decision repository.

  Require a full-scope token-bound principal plus current Catalog and P12 metadata authority for Portfolio Sponsor projections. Add the Root-authorized Data Steward/Privacy/Compliance Console plane for content-free lifecycle display, Hold review/release, subject erasure/export, retention purge, and reconciliation; identity and authority fields supplied by callers are rejected.

  Add an optional persistent `sponsorConversation` delivery view to Workroom Catalog entries. Multiple Projects may share one portfolio-level Sponsor Room address, while controls require an explicit Project id and every outbound item remains Project-scoped. The Host bootstraps the exact current Endpoint binding before the first outbound alert; queued projections revalidate current Catalog membership/binding plus the Sponsor-specific P12 channel and manifest immediately before delivery.

  Deliver content-free Portfolio lane, queue-head, grant/reclaim, budget, blocker, and fairness cards through that same governed Sponsor Room outbox. Strict Project-scoped Portfolio lane/status/budget-transfer controls use the authenticated Sponsor ingress path; a current card reply may supply the Project selector, switching Projects never rewrites a room-wide binding, and conflicting/stale explicit or reply targets are clarified without mutation.

  Keep Local Assignment recovery scans independent from long-running executors, and use one locale-independent canonical comparator throughout Workroom, Portfolio, and Data Governance authority ordering.

  Add `zhin agent legacy-runs <input>` and `zhin agent legacy-payloads <input> --kind <kind>` as offline recovery aids. Both commands read legacy data without mutating it and write create-only audit/proposal output; they never promote a legacy `completed` Run to accepted state, write a new Workroom Journal, delete embedded payloads, or perform an automatic migration. Any replacement work still requires explicit admission through the new Kernel.

- Updated dependencies [67ef8c4]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [985fa22]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/console-protocol@1.1.3

## 1.0.10

### Patch Changes

- e4757a8: fix: bump
- Updated dependencies [e4757a8]
  - @zhin.js/console-protocol@1.1.2

## 1.0.9

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

## 1.0.8

### Patch Changes

- 0de46a8: 删除进程级 `AgentRuntimeRegistry` 与按 Endpoint 复制 `ZhinAgent` 的运行时子图。

  Plugin Runtime 现在只有一个 generation-owned Agent 权威；协作任务通过显式 binding 在该 Agent 的 SubAgent 系统中执行，不再通过 Endpoint key 查找或隐式回退到另一个可变 Agent 实例。持久化就绪状态也只提交给当前 generation 的 Agent。

  Console 的 Agent 工具、MCP、会话树、Assistant 与 Orchestration 端口统一从其正在观察的 `RuntimeSnapshot` 根资源读取 `agentHostToken`，不再拼接多个“最新 generation”全局 store。相应移除公开的 registry/bootstrap API。

  Console Host 的 Agent runtime 接口改为 lease-bound `acquireAgentRuntime`；所有异步 Session、Assistant 与 Orchestration 操作在完成前持有 generation lease，避免 HMR 中途销毁正在使用的旧代资源。

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/plugin-runtime@1.1.5

## 1.0.7

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/console-protocol@1.1.1
  - @zhin.js/host-http-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.6

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3

## 1.0.5

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2

## 1.0.4

### Patch Changes

- d8bf702: fix: resolve GitHub security alerts (XSS, ReDoS, vulnerable dependencies)

  - Sanitize URL schemes in `resolveMediaSrc` to reject `javascript:` and other dangerous protocols
  - Replace polynomial regex patterns with loop-based `trimTrailingSlashes` to prevent ReDoS
  - Use `String.trimEnd()` instead of `/\s*$/` regex in env text merging
  - Fix incomplete URL substring sanitization in tests
  - Upgrade `adm-zip` to ^0.6.0 (fixes GHSA-xcpc-8h2w-3j85)
  - Add pnpm override to force `axios ^1.19.0` for `qq-official-bot`
  - Update transitive dependencies via `pnpm update`

## 1.0.3

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- Updated dependencies [cdf64e7]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1

## 1.0.2

### Patch Changes

- 1ddcd70: Console/契约扫尾批：

  - adapter：多 endpoint record name 改为 entry.name（Console 展示/resolve/inbox 按名唯一命中）；`expandEndpointConfigs` 增加缺名/非法字符/重名校验与告警；slack endpoint 补 `name` getter；inbox-installer / agent-host 解析 `slot~entry` 展开 id（activity-feedback 随之恢复）。
  - host-http：`schema:get`/`config:get` 兼容 `data.plugin`；extended RPC 参数顶层与 `data` 合并（cron 写操作修复）；请求审批认 `requestId`、已读认单值 `id`；`endpoint:requests`/`inboxRequests`/`inboxNotices` 行补 camelCase/扁平别名；cron 列表补 `expression/running/plugin/nextExecution/createdAt/context`。
  - cli：装配 `setOrchestrationRuntime`/`setSessionTreeRuntime`（agent-sessions/orchestration 页恢复）；`/api/stats` 补 commands/components 计数；console REST databaseHost.started 改动态 getter；`wrapModel` 支持 orderBy/limit 链式查询；接线 SystemLog 模型 + 日志 transport（logs 页有真实数据，带 7 天/1 万条清理）。
  - plugin-runtime：`DatabaseHostModel.select` 升级为链式 `DatabaseHostSelection`；新增 `system-log`（SystemLog 表定义/写入助手）。
  - agent：导出 `asPrivate`（Runtime Host 装配 session tree runtime 用）。

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/console-protocol@1.1.0

## 1.0.1

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
