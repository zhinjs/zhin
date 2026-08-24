# @zhin.js/host-http

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
