# @zhin.js/client

## 1.1.25

### Patch Changes

- 6163abc: Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.
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

- 4427e72: 新增 `@zhin.js/client/ui` 插件页 UI 套件（Button/Badge/Notice/状态组件/ConfirmButton/Field、`usePluginRpc`、`useLocale`、`resolvePluginId` 与基于 Console 主题变量的样式），并用它重写通用适配器页：加载/失败/过期状态分离，原生 `confirm` 改为行内确认，按操作独立的忙碌状态，修复数据未到达时误显示“配置里还没有账号”的问题。
- 22bd14a: Add `createCommentReviewPage(spec)` (plus `ReviewResourceList` and the `CommentReviewSpec` / `ReviewContext` types): one shared comment-review Console page built only on the `@zhin.js/client/ui` kit, for adapters that draft replies for human approval. It resolves the PluginId, keeps the last good status as stale on refresh failure, sends discard through an inline `ConfirmButton`, keeps error notices until dismissed, and shows overflow as text ("超出 N 字"). The legacy `ac-*` review styles are removed from `adapterConsoleStyles`.
- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
  - @zhin.js/console-protocol@1.1.14
  - @zhin.js/contract@1.1.20

## 1.1.24

### Patch Changes

- cce07db: Refresh adapter Console pages with lightweight black/white/gray surfaces, clearer account and login workflows, responsive layouts, accessible focus states, and self-contained light/dark styling. Apply the shared visual language to Sandbox conversations and Bilibili comment review while preserving runtime authority and platform send paths.
- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [bd524d1]
- Updated dependencies [126ae99]
- Updated dependencies [4fe49b5]
  - @zhin.js/console-protocol@1.1.13
  - @zhin.js/contract@1.1.19

## 1.1.23

### Patch Changes

- f78eb84: fix(client): resolve adapter Console pages from npm `adapter-{key}/pages/` sources as well as workspace `adapters/{key}/pages/`, so qq/icqq/github pages stop showing "找不到页面所属插件" after install from registry.
  - @zhin.js/contract@1.1.18

## 1.1.22

### Patch Changes

- 2c3610a: Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

  Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

  Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

  Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

  Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.

  - @zhin.js/contract@1.1.17

## 1.1.21

### Patch Changes

- 6345a38: feat(adapters): add per-adapter Console pages

  Every platform adapter now ships a `pages/index` Console page backed by a shared
  `createAdapterConsolePage` component and `createAdapterConsoleRpc` server helper:

  - See running endpoints, test connectivity, and manage
    `plugins.<adapter>.endpoints` (add/remove writes `.env` references) from the
    Console instead of chat commands.
  - Surface LoginAssist pending tasks (QR / slider / SMS / device) so ICQQ login no
    longer requires the terminal.
  - QQ moves its QR binding flow (`qq endpoint add`) into Console actions with
    public/private selection.
  - Pages are permission-gated by `<adapter>:read`; writes need `<adapter>:write`.
  - @zhin.js/contract@1.1.16

## 1.1.20

### Patch Changes

- @zhin.js/contract@1.1.15

## 1.1.19

### Patch Changes

- f3b7c9f: 新增 Console RPC `config:patch`：按路径写入配置，供面向普通用户的简单页面使用（#970）。

  - 路径白名单：带 `instanceKey` 时只能写该插件实例自己的配置块，以及插件 `schema.json` 根部 `x-zhin-config.patchPaths` 声明的 Host 子路径；省略时只能写 `HOST_CONFIG_PATCH_PATHS`（目前为 `ai.trigger.ambient`）。
  - `expectedRevision` 必填；文件已变时返回 `status: 'conflict'` 和最新值，不覆盖。
  - 写入前按 schema 校验每个被改动的配置块；成功响应带 `restartRequired`，`config:updated` 事件新增 `paths` 与 `revision` 字段。
  - `@zhin.js/client` 新增 `patchConfig()`；`@zhin.js/service-typesafe` 声明可写 `ai.decisions`。

  纯新增能力：`config:set`、`config:replace-source` 与 YAML 编辑器行为不变，无需迁移。`config:patch` 只接受 full scope Token，Demo 部署不可用。

- 658a5fb: Console access is now per token. Entries in `http.tokens` can set `permissions` and `roles`. The Console filters navigation and page lists (`/entries`, `/console/api/pages`, `/console/api/topology`, page shells and the `pages:list` RPC) by the caller's token. Plugin `status` RPC is open to a non-admin token that holds the bound page's requirements. Full-scope tokens, and Hosts with no tokens configured, still see everything. Page lists are no longer evaluated with empty access, so pages that declare `requiredPermissions` are now visible to the users allowed to see them.
- af29996: 为 Page 元数据增加可选 titleI18n，在页面目录、导航与 Console 客户端注册链路中保留显式标题翻译。Sandbox 页面提供英文导航标题，缺少对应语言时保留插件原题，不修改路由或访问规则。
- b8e594e: Plugins can register Console status and limited actions with `definePluginConsoleRpc` and `pluginConsoleRpcToken`. Pages call them as `plugin.<pluginId>.status` and `plugin.<pluginId>.<action>` through the existing Console request, using `pluginRpc()` from `@zhin.js/client`. Access follows the bound page's `requiredPermissions` and `requiredRoles`. Actions need the full-scope token, and the demo token can read status only when the plugin opts in. Input, output and run time are bounded, and raw errors never reach the page.
- Updated dependencies [f3b7c9f]
- Updated dependencies [af29996]
- Updated dependencies [b8e594e]
  - @zhin.js/console-protocol@1.1.12
  - @zhin.js/contract@1.1.14

## 1.1.18

### Patch Changes

- @zhin.js/contract@1.1.13

## 1.1.17

### Patch Changes

- @zhin.js/contract@1.1.12

## 1.1.16

### Patch Changes

- @zhin.js/contract@1.1.11

## 1.1.15

### Patch Changes

- f30be42: Stop publishing unit test files (`src/**/*.test.ts`, `client/**/*.test.ts`) in the npm tarball.
- Updated dependencies [d13b1d7]
- Updated dependencies [1971e0c]
  - @zhin.js/console-protocol@1.1.11
  - @zhin.js/contract@1.1.10

## 1.1.14

### Patch Changes

- Updated dependencies [7edd04c]
- Updated dependencies [2b4d6dc]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
  - @zhin.js/console-protocol@1.1.10
  - @zhin.js/contract@1.1.9

## 1.1.13

### Patch Changes

- @zhin.js/contract@1.1.8

## 1.1.12

### Patch Changes

- @zhin.js/contract@1.1.7

## 1.1.11

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/console-protocol@1.1.9
  - @zhin.js/contract@1.1.6

## 1.1.10

### Patch Changes

- b3fea8c: Agent turn traces are now persisted in `data/agent-traces/<day>.jsonl`, kept for 7 days with a 64 MB size cap (`ZHIN_TRACE_RETENTION_DAYS`, `ZHIN_TRACE_MAX_MB`), and redacted again when written. `zhin trace` can filter by session and time (`--sessions`, `--session`, `--since`, `--until`). A new read-only host API (`/api/agent/trace-archive/*`, full scope) backs the Console Agent Trace page (`TraceArchivePage`), which goes from sessions to turns to a turn detail with a waterfall and the raw record. Failing agent evals print a `zhin trace` command that opens the failing case's trace (#728).
- Updated dependencies [4778587]
- Updated dependencies [681abf3]
  - @zhin.js/console-protocol@1.1.8
  - @zhin.js/contract@1.1.5

## 1.1.9

### Patch Changes

- @zhin.js/contract@1.1.4

## 1.1.8

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/console-protocol@1.1.7
  - @zhin.js/contract@1.1.3

## 1.1.7

### Patch Changes

- 5b5d270: Complete the canonical share segment contract and preserve native ICQQ share delivery through Core and AI outbound pipelines.
  - @zhin.js/contract@1.1.2

## 1.1.6

### Patch Changes

- 244e475: Add a shared CLI and Console plugin-management transaction for install, update,
  uninstall, configuration validation, lifecycle control, diagnostics, Marketplace
  discovery, and Endpoint connectivity checks. Console mutations use revision checks,
  exact-version plans, post-operation verification, and recoverable manifest and
  lockfile snapshots.
- f474b1d: Replace the process-wide Console application, runtime environment, and WebSocket singleton with an explicitly created `ConsoleClient` that owns its application registry and REST/SSE transport. React transport hooks now resolve that owner through `ConsoleClientProvider`, and the obsolete `addPage` compatibility alias is removed from the plugin registration contract.
- 2dbbc15: Classify watched Root configuration changes by their actual Host and Plugin projections, reload only affected Plugin subtrees, and request a process restart for Host configuration changes. Reload project dotenv layers as Runtime inputs so environment references are re-expanded without mutating global process state.
- baef56b: Require canonical dot-named Console RPCs with top-level camelCase request and response payloads, and remove legacy aliases and normalization paths.
- 507d602: Make the Root `ConfigFileDocument` the sole configuration authority for Runtime, Endpoint commands, and Console. Console source editing now preserves the active YAML or JSON format, uses optimistic revision checks, returns one consistent source-and-key snapshot, and exposes canonical `config:get-source` / `config:replace-source` RPCs without the former YAML-only compatibility names.
- Updated dependencies [244e475]
- Updated dependencies [f474b1d]
- Updated dependencies [baef56b]
- Updated dependencies [507d602]
  - @zhin.js/console-protocol@1.1.6
  - @zhin.js/contract@1.1.1

## 1.1.5

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- Updated dependencies [1fc6270]
  - @zhin.js/console-protocol@1.1.5
  - @zhin.js/contract@1.1.0

## 2.1.14

### Patch Changes

- 882a08a: Complete first-run Workroom disclosure setup with explicit model-processor contracts, a self-hosted Root-private AES/HMAC authority, Catalog-bound P12 publication, Console diagnostics, and fail-closed regression coverage.
  - @zhin.js/contract@1.0.19

## 2.1.13

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.
  - @zhin.js/contract@1.0.18

## 2.1.12

### Patch Changes

- @zhin.js/contract@1.0.17

## 2.1.11

### Patch Changes

- b10d058: Preserve standard SSE event metadata, expose typed resumable Console event history, recover missed events before reconnecting the live stream, and allow durable unread notices to be rebuilt after a history gap.
- Updated dependencies [b10d058]
- Updated dependencies [f2c532f]
  - @zhin.js/console-protocol@1.1.4
  - @zhin.js/contract@1.0.16

## 2.1.10

### Patch Changes

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 1312ca0: Replace the legacy mutable orchestration stack with the event-sourced Workroom Kernel.

  - `@zhin.js/agent` now exposes versioned Workroom events, pure replay/decision state transitions, CAS journals, and a read-only runtime projection. The public `OrchestrationService`, mutable repositories, `AgentDispatcher`, executor/workflow APIs, remote Agent registry/poller, old orchestration tools/constants, and five-agent workflow strategy are removed.
  - `zhin.js/agent` no longer exports the immediate-execution `runPipeline`, `runParallel`, or `route` helpers. Use `AIService.runAgent` for an ordinary one-shot model call; durable multi-Agent collaboration must enter a Workroom Plan and Assignment lifecycle.
  - `spawn_task` is now only an ordinary chat subtask facility. It no longer accepts Run/Task identifiers, creates Runs from IM sessions, dispatches remote tasks, or writes Workroom state.
  - `@zhin.js/ai` no longer owns IM Agent orchestration database models or the unused `ai.remoteAgents` configuration. Workroom persistence belongs to `@zhin.js/agent` as `workroom_events` or an atomic file journal.
  - The Workroom journal backend is fixed for the process lifetime. Changing `ai.sessions.useDatabase` requires a process restart; an unavailable selected database rejects generation activation instead of falling back to another authority.
  - The CLI exposes the read-only Project-scoped Console API at `/api/agent/workroom/runs`; the old `/api/agent/orchestration/runs` route is removed. No model-writable Workroom compatibility tools are published: future command adapters must hold an authenticated Project capability and dedicated Scheduler/Executor/Acceptance ports.
  - The Console client now queries Workroom Runs by `projectId` and renders the replayed Task revision/attempt state. `registerOrchestrationConsole`, `OrchestrationRunsPage`, and `/console/orchestration` are removed in favor of the Workroom-named surface.

  Execution completion and acceptance are separate durable facts. All writes use `append(runId, expectedSequence, events)`; no mutable Task projection can act as a second authority.

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

- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [985fa22]
  - @zhin.js/console-protocol@1.1.3
  - @zhin.js/contract@1.0.15

## 2.1.9

### Patch Changes

- @zhin.js/contract@1.0.14

## 2.1.8

### Patch Changes

- Updated dependencies [e4757a8]
  - @zhin.js/console-protocol@1.1.2
  - @zhin.js/contract@1.0.13

## 2.1.7

### Patch Changes

- @zhin.js/contract@1.0.12

## 2.1.6

### Patch Changes

- @zhin.js/contract@1.0.11

## 2.1.5

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/contract@1.0.10
  - @zhin.js/console-protocol@1.1.1

## 2.1.4

### Patch Changes

- @zhin.js/contract@1.0.9

## 2.1.3

### Patch Changes

- @zhin.js/contract@1.0.8

## 2.1.2

### Patch Changes

- @zhin.js/contract@1.0.7

## 2.1.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。
  - @zhin.js/contract@1.0.6

## 2.1.0

### Minor Changes

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

### Patch Changes

- 5849336: 修复 console hooks 自动加载的零退避死循环：`useConfig` / `useConfigYaml` / `useFiles` / `useEnvFiles` / `useDatabase` 在 RPC 失败时会以全速反复请求 `/api/console/request`（状态为空 → effect 立即重试）。新增 `useAutoLoadOnce`：每次连接会话对同一 key 只自动加载一次，断连重置，手动重试仍可用。
- Updated dependencies [ac9da66]
  - @zhin.js/console-protocol@1.1.0
  - @zhin.js/contract@1.0.5

## 2.0.6

### Patch Changes

- @zhin.js/contract@1.0.4

## 2.0.5

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/contract@1.0.3

## 2.0.4

### Patch Changes

- 5cc9c03: fix: ai 优化
- Updated dependencies [5cc9c03]
  - @zhin.js/contract@1.0.2

## 2.0.3

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限

## 2.0.2

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - @zhin.js/contract@1.0.1

## 2.0.1

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.1.4

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - @zhin.js/console-types@0.1.5

## 1.1.3

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [f19d2e0]
  - @zhin.js/console-types@0.1.4

## 1.1.2

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/console-types@0.1.3

## 1.1.1

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/console-types@0.1.2

## 1.1.0

### Minor Changes

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

## 1.0.18

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/console-core@0.1.1
  - @zhin.js/console-types@0.1.1

## 1.0.17

### Patch Changes

- 4304825: fix: 重新发版

## 1.0.16

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2

## 1.0.15

### Patch Changes

- c212bf7: fix: 适配器优化

## 1.0.14

### Patch Changes

- 16c8f92: fix: 统一发一次版

## 1.0.13

### Patch Changes

- bb6bfa8: chore: 控制台路由 key、client tsc、页面模块化拆分；client/satori 的 clean 与构建产物约定对齐

## 1.0.12

### Patch Changes

- 353de3d: fix: 控制台优化

## 1.0.11

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优

## 1.0.10

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强

## 1.0.9

### Patch Changes

- 106d357: fix: ai

## 1.0.8

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai

## 1.0.7

### Patch Changes

- f9faa1d: fix: test release

## 1.0.6

### Patch Changes

- d16a69c: fix: test trust publish

## 1.0.5

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.4

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例

## 1.1.0 (2024-10-22)

### Major Features

- ✨ **插件配置系统** - 基于 Schema 的自动化配置表单

  - 完整支持 15 种 Schema 数据类型
  - 智能 UI 组件自动选择
  - 支持任意深度的嵌套结构
  - 实时配置读取和保存

- 🏗️ **组件模块化重构**
  - PluginConfigForm 拆分为 8 个模块（17 个独立渲染器）
  - 职责单一，易于测试和扩展
  - 向后兼容，使用方式不变

### Improvements

- 🎨 表单布局优化

  - 使用 ScrollArea 控制高度
  - 使用 Accordion 折叠复杂字段
  - 统一组件尺寸（size="1"）
  - 智能分组（简单字段 vs 复杂字段）

- 📝 文档完善
  - 新增 `DEVELOPMENT.md` 开发文档
  - 更新 `README.md` 添加配置系统说明
  - 详细的 API 参考和最佳实践

### Bug Fixes

- 🐛 修复 Schema 格式兼容性问题（dict vs properties）
- 🐛 修复嵌套字段状态管理问题
- 🐛 修复 definitions 字段名称问题

## 1.0.3

### Patch Changes

- c2d9047: fix: 重复插件 bug
- c2d9047: fix: 优化中间件逻辑
- b213bbc: fix: 更新 kook 报错

## 1.0.2

### Patch Changes

- d291005: fix: 更新 cli,更新 http

## 1.0.1

### Patch Changes

- 727963c: fix: 修复 sqlite 数据错误;优化 console 展示
