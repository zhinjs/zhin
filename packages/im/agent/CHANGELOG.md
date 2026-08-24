# @zhin.js/agent

## 1.1.16

### Patch Changes

- e9c6a73: Close lifecycle races across IM activity indicators, subagent cancellation and schedule feedback: retry inactive starts, serialize native typing keepalives with cleanup, await generation disposal without task-observer self-deadlocks, propagate subagent abort signals without delivering retired-generation results, preserve spawn/start/finish ordering, and make same-scene schedule locks executor-owned and lifecycle-drained. The deprecated global schedule-lock drain remains exported for compatibility but now fails explicitly with migration guidance instead of falsely reporting that generation-owned executors were drained.
- 902fa35: Separate Adapter definitions from live Endpoint responsibilities in activity feedback. Runtime feedback now depends on a narrow outbound send port and the concrete Endpoint control surface instead of fabricating the legacy all-in-one Adapter class.
- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- 12025ee: Project exact Endpoint control capabilities through the outbound Host and connect native typing, editable progress, ordered Agent/subagent/tool events, and transient Schedule completion states to IM activity feedback. Gate event ingress by the committed Runtime generation, pin Endpoint operations and retirement cleanup to that generation's IM snapshot, and guarantee terminal cleanup across public Agent error and cancellation paths.
- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/prompt-section@0.0.1
  - @zhin.js/core@1.5.14
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/ai@1.5.7
  - @zhin.js/logger@1.0.77
  - @zhin.js/skill@1.0.13
  - @zhin.js/tool@1.0.13
  - @zhin.js/agent-feature@1.0.13
  - @zhin.js/mcp-feature@1.0.13
  - @zhin.js/permission@1.0.4
  - @zhin.js/kernel@1.0.8

## 1.1.15

### Patch Changes

- 3dbf990: Add content-free Workroom readiness diagnostics and authenticated Sponsor controls for exact-sequence Run cancellation and durable replan requests.
- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13

## 1.1.14

### Patch Changes

- d336a3f: Remove the process-global Assistant, legacy orchestration, and session-tree registries. Host and Console operations resolve narrow projections exclusively from the request's generation-owned `AgentHostPort`; the Workroom major changeset removes `OrchestrationService` itself rather than retaining another mutable command authority. Shadow generations can no longer publish operational state before commit, retired generations cannot leak back into service, and Console no longer receives concrete mutable repositories, engines, ingress objects, or orchestration services.

  Also remove the unused process-global bootstrap gate, connection authorization queue, session agent-state store, and the empty `@zhin.js/agent/connection` compatibility subpath. The inert state-authoring contract is removed in full: `defineState`, its public definition/discovery types, `DiscoveredPluginAgentSurface.states`, `AgentSurfacePluginInfo.states`, and `agent/state/*` discovery/reporting no longer exist. These experimental APIs had no production authority or lifecycle owner; connection authorization and durable state must be supplied by explicit generation-owned ports instead.

  Remove the equally inert `defineDynamic` contract, `agent/dynamic.ts` discovery, process-global resolver registry, and per-turn prompt scratch field. Although files were reported as discovered, no production composition path ever registered them. Dynamic turn policy must be modeled as an explicit generation-owned projection rather than a latest-live module registry.

  Make the Schedule `JobWorker` the sole owner of a narrow private `ScheduleExecutionQueue`, removing the public generic orchestrator `TaskQueue`, module-level latest-generation lookup, implicit queue/timer construction fallback, speculative DAG/priority/listener APIs, and the direct-execution bypass. Queue timeout and disposal now propagate cancellation through `TaskExecutor` into the Schedule Turn, retain their concurrency/lifecycle slot until the real operation settles, settle every queued waiter, and reject use after disposal. Remove the deprecated `AssistantJob*`, `createAssistantJobStore`, `getAssistantJobsPath`, `legacyDualWrite`, and inert `jobsFile` configuration surfaces; Schedule naming and the fixed `schedule-jobs.json` path are now the only contracts.

- 0c82a7e: Remove the process-global remote Agent and task-poller registries. Remote orchestration now receives an explicitly generation-owned `RemoteAgentRegistry`; configured Agent Cards are validated and must be ready before a candidate generation can publish. Delegation, SSE continuations, non-streaming polling, and persisted-task recovery are tracked and drained by that owner, while the old public poller API has been deleted.
- b9217e4: Replace the process-global semantic-memory repository and classic memory tools with a generation-owned `SemanticMemoryRuntime` and native ToolFeature definitions. Enabling semantic memory now requires a ready Database Host and `memory_entries` model; invalid candidates fail closed instead of silently using process-global or ephemeral memory.

  Completed orchestration runs are no longer written to semantic memory implicitly. Persisting a run summary now requires an explicit, authorized memory write through the generation-owned tool/runtime, so orchestration completion and durable user memory no longer share a hidden side effect.

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 5969c5b: Preserve shared-session participant attribution through conversation persistence and compaction, add explicit turn intent routing, expose the compatible supersede/FIFO overlap policy, and retain causal participants on tool journal events.
- 2f786bd: Replace text-only IM context and metadata-based quote handling with canonical
  conversation events, scoped reference resolution, explicit Endpoint content
  ports, and typed multimedia outcomes. Conversation notices are projected as
  untrusted context data rather than model-authority system instructions.
  The process-global passive-group buffer is removed: prior inbound conversation messages
  are now consumed from the same event store and cursor, with the current Turn
  message excluded from its own context projection.
  The unused `ConversationMemory` topic-memory runtime, its timers, legacy tables,
  and topic-window configuration are removed; `ContextRepository` is the only
  Agent conversation-history authority.
- 63d89f9: Remove the unconstrained `accept_task` Workroom command. Task acceptance now enters through a trusted `WorkroomAcceptancePolicyDecisionPort`; the Kernel validates exact Task/Assignment/candidate bindings and permits automatic acceptance only for low-risk, fully deterministic, evidence-complete candidates before appending a structured Acceptance Record with Journal CAS.

  Pre-policy `task.accepted` journal entries do not satisfy the new record schema and must be exported for audit and replanned instead of being silently promoted to accepted Project state.

  Task revisions must now pin an immutable Acceptance Contract and Policy snapshot before an Executor can claim them. The standard Agent Host resolves the provider through the generation-owned `workroomAcceptancePolicyDecisionToken`, so hot reload cannot replace the contract already recorded in a Run.

  Policy routes that require judgment or high-risk authority now append durable, candidate-hash-bound Reviewer Assignment or Sponsor Gate facts. Each wait records its pinned Contract/Policy, owner, deadline and recovery actions; expiry is replayable and can be reopened by a fresh policy evaluation, replanned or cancelled without waiting for an Agent response.

  Reviewer claims/verdicts and Sponsor decisions now enter through typed Kernel methods backed by a generation-owned `WorkroomAcceptanceAuthorityPort`. Every authorization is rebound to the exact Project, Run, Task, target and Journal sequence; producer self-review, stale candidates, incomplete criterion/claim disposition and untrusted authority are rejected. Reviewer-only and Reviewer-then-Sponsor routes now produce replayable Acceptance Records with principal and control-target proof.

- 71c7cdd: Add the first production Data Governance boundary. Unknown or malformed descriptor input is quarantined against a trusted category/kind confidentiality floor, while the pure disclosure policy returns only typed `full`, `metadata_only`, `transform_required`, `approval_required`, or `deny` decisions bound to the exact descriptor, policy, channel, purpose, principal, processing destination, recipient snapshot, transform, and approval scope.
- 3cca0ea: Advance the production Workroom boundary with four fail-closed contracts:

  - project accepted Task claims into immutable Task Memory and typed, CAS-bound Project State patches without admitting rejected or free-form report content;
  - persist Remote A2A dispatches in a crash-durable, fenced Memory/File Outbox with payload-sensitive idempotency and reconciliation states that cannot complete Tasks;
  - execute exact role-scoped Assignment envelopes through a cancellable observation-only Executor port; and
  - register, govern, activate, roll back, and pin immutable Project Profile revisions, requiring Sponsor authority for bootstrap or semantic capability expansion.

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

- 04b861d: Route local and remote Assignment observations through the fenced Workroom Kernel CAS, add a crash-durable authenticated Remote Callback Inbox with ordered reconciliation, and remove the legacy unfenced heartbeat and execution-completion commands.
- a23d544: Add the first independent Portfolio Admission production boundary: a strict content-free Capacity Request parser and a Portfolio-only Journal repository contract with expected-sequence CAS, payload-sensitive idempotency, immutable atomic Resource Bundles, and explicit rejection of Workroom Task, Plan, Context, Memory, Artifact, Evidence, prompt, message, title, and tool-argument payloads.
- 8cddabf: Add production Workroom execution infrastructure: a durable remote-dispatch worker, a constrained local Assignment Executor, a crash-durable Profile Journal, atomic Portfolio Resource Bundle admission, and content-free materialized Disclosure Manifests backed by trusted policy and destination digests.
- dbe5081: Add the first production contracts for the remaining Workroom cutover:

  - immutable, content-digested Remote A2A Dispatch envelopes and a generation-owned outbound executor port whose receipts are observations rather than Task terminal facts;
  - a fail-closed Profile compiler for exact Capability Pack revisions and generation capability supply; and
  - an I/O-free `WorkflowPlanBuilder` that returns deterministic versioned DAG proposals without executing Agents or writing Workroom state.

- Updated dependencies [67ef8c4]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/im-contract@1.0.4
  - @zhin.js/core@1.5.12
  - @zhin.js/ai@1.5.6
  - @zhin.js/agent-feature@1.0.12
  - @zhin.js/mcp-feature@1.0.12
  - @zhin.js/permission@1.0.3
  - @zhin.js/skill@1.0.12
  - @zhin.js/tool@1.0.12

## 1.1.13

### Patch Changes

- @zhin.js/core@1.5.11

## 1.1.12

### Patch Changes

- Updated dependencies [0b8b5bd]
  - @zhin.js/ai@1.5.5
  - @zhin.js/core@1.5.10

## 1.1.11

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - @zhin.js/agent-feature@1.0.11
  - @zhin.js/mcp-feature@1.0.11
  - @zhin.js/skill@1.0.11
  - @zhin.js/tool@1.0.11

## 1.1.10

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - @zhin.js/ai@1.5.4
  - @zhin.js/agent-feature@1.0.10
  - @zhin.js/mcp-feature@1.0.10
  - @zhin.js/skill@1.0.10

## 1.1.9

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

- 6fb24dd: Replace the concrete `AIService` and `ZhinAgent` escape hatches on `AgentHostPort`
  with a canonical protocol port that lists immutable Agent bindings and executes
  `TurnRequest`s. `AgentRuntime` selections now require the immutable binding for
  the turn so provider/model state remains isolated across concurrent requests.

  Route A2A tasks through the canonical Agent runtime without synthetic IM
  messages or shared `agent.configure()` mutation. A2A callers now enter as a
  fail-closed `user` principal, cancellation propagates through the turn
  `AbortSignal`, and task completion continues to project through the A2A event
  bus.

- d162216: Replace Message-shaped session management with canonical session-key interfaces.
  `ZhinAgent.archiveSession`, `ZhinAgent.compactSession`, and the session-tree
  helpers now accept a stable session key instead of a synthetic IM Message.

  Route Plugin Runtime transcript recording, passive group context, management
  commands, and Owner approval through immutable Turn access/address data. Owner
  approval persistence now has one origin-neutral implementation shared by the
  canonical command path and the remaining classic policy adapter. Ordinary IM
  turns no longer construct a synthetic Message; that projection is isolated to
  configured collaboration Cell orchestration.

- 7427818: Route scheduled and preview Agent work through the generation-owned canonical Turn ingress and the single full Agent core. Remove the synthetic IM Message schedule path, legacy schedule-context execution branch, and duplicated schedule tool-security wrapper.

  Add a typed direct capability-resolution event and explicit canonical Shell preset authority. Schedule execution is stateless, fail-closed, journaled, budgeted, audited, and uses the same capability policy/runtime as other canonical turns.

- 90da255: Remove the unreachable classic Plugin bootstrap, process-global authoring registration, and the parallel HTTP Agent session runtime. Agent setup is now owned exclusively by the Plugin Runtime composition root, authoring capabilities are published only through generation projections, and transport approval must be supplied explicitly through `ApprovalPort`.

  Also remove the classic proactive-dispatch factory and stop `AIService` standalone agents from fabricating an authenticated IM message. Standalone execution without an authenticated IM origin now carries no message authority and therefore remains fail-closed under tool policy.

  BREAKING CHANGE: `initAgentModule`, `createAgentSessionHostPort`, `HttpAgentSessionStore`, `FileHttpSessionPersistence`, `HttpStepProjector`, `HttpApprovalWaiter`, `createProactiveOutboundService`, `registerPluginAgentSurfaces`, and related HTTP-session types are removed. Protocol hosts must execute canonical `TurnRequest` values through the generation-owned `AgentHostPort`; proactive delivery must be implemented by the generation-owned IM runtime.

- 953cfe1: Remove the obsolete Collaboration Scene/Cell domain after Agent coordination
  moved to the Orchestration Kernel. This deletes `/collab`, the initialization
  wizard, Scene identity and membership repositories, archived Cell pipeline
  state, seven Collaboration database tables, and their public exports.

  The top-level `collaboration` configuration key is no longer accepted and now
  fails schema validation. Agent startup is selected only by `ai` or `assistant`.

  Keep the optional Five-Agent workflow as an independent Agent module with
  `FiveAgentRole`, role binding, and role capability policy interfaces. It no
  longer depends on IM scenes, Bot membership, or text handback conventions.

  Remove `StructuredOutboundDetectInput.collaborationCell`; structured outbound
  selection is based only on tool, handoff, and Adapter capability requirements.

- 0e73866: Remove the classic Message-based Collaboration Cell execution seam. IM now
  serves only as canonical turn ingress and reply delivery; Agent-to-Agent work is
  executed by the Orchestration Kernel through `local` Agent bindings or
  `remote_mesh` A2A agents.

  Remove peer mention routing, synthetic Message bridging, Cell prompt injection,
  IM projection executors, `internal_room`, and the dead Collaboration outbound
  parser APIs. Orchestration executor and persisted source parsing now fail closed
  for removed legacy shapes instead of silently changing execution domains.

  `AITriggerConfig.peerMode` and the public `internal_room` / `im_projection`
  executor variants are removed. Local task `assignedTo` values now name an Agent
  binding; remote tasks name an A2A Agent.

- Updated dependencies [63253bb]
- Updated dependencies [7427818]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/mcp-feature@1.0.9
  - @zhin.js/tool@1.0.9
  - @zhin.js/ai@1.5.3
  - @zhin.js/agent-feature@1.0.9
  - @zhin.js/permission@1.0.2
  - @zhin.js/skill@1.0.9

## 1.1.8

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7

## 1.1.7

### Patch Changes

- 7945544: fix(command): 修复 CommandSession.sender.role 缺失 master/trusted 及平台群角色

  `resolveRoles` / `resolveSender` 现在从 IM Message 的 `$sender` 读取 `isMaster`、`isTrusted` enrich 快照和平台 `role` 字段，
  而非仅依赖 duck typing 接口的 `sender` 和 `metadata`。

  fix(agent): 启动时自动清理旧版 agent_sessions 表的 NOT NULL IM 地址列

  旧版 `agent_sessions` 包含 `platform`、`endpoint_id`、`scene_id`、`scene_type`、`bot_id` 五个 NOT NULL 列（origin-neutral 重构前），
  新 model 不再包含这些列，但 `CREATE TABLE IF NOT EXISTS` 不修改已有表结构，导致 INSERT 因缺失 NOT NULL 值而失败。
  新增 `dropLegacyAgentSessionImColumns()` 在启动时检测并通过 `ALTER TABLE DROP COLUMN`（SQLite ≥ 3.35.0）自动移除。

  - @zhin.js/core@1.5.6

## 1.1.6

### Patch Changes

- @zhin.js/core@1.5.5

## 1.1.5

### Patch Changes

- 6f9c366: Make the full Agent Core origin-neutral by removing legacy IM Message and Plugin
  lifecycle dependencies from model execution, compaction, and tool hooks. Tool
  security remains exclusively owned by the required per-turn
  `ToolExecutionAuthority`.
- 373a56b: Make the full Agent Core depend on one required ToolExecutionAuthority. Policy, approval, journal, cancellation, and execution now remain behind a turn-owned adapter, allowing canonical TurnToolRuntime execution without a second Agent loop or duplicate approval path.
- 0de46a8: 删除进程级 `AgentRuntimeRegistry` 与按 Endpoint 复制 `ZhinAgent` 的运行时子图。

  Plugin Runtime 现在只有一个 generation-owned Agent 权威；协作任务通过显式 binding 在该 Agent 的 SubAgent 系统中执行，不再通过 Endpoint key 查找或隐式回退到另一个可变 Agent 实例。持久化就绪状态也只提交给当前 generation 的 Agent。

  Console 的 Agent 工具、MCP、会话树、Assistant 与 Orchestration 端口统一从其正在观察的 `RuntimeSnapshot` 根资源读取 `agentHostToken`，不再拼接多个“最新 generation”全局 store。相应移除公开的 registry/bootstrap API。

  Console Host 的 Agent runtime 接口改为 lease-bound `acquireAgentRuntime`；所有异步 Session、Assistant 与 Orchestration 操作在完成前持有 generation lease，避免 HMR 中途销毁正在使用的旧代资源。

- b08f7fe: refactor(agent): migrate global registries to generation-scoped stores

  Replace module-level global singletons with createGenerationStore across
  orchestration, schedule, session-tree, typing-indicator, assistant,
  collaboration, and memory-entry registries. Pattern changes from
  set*/register* to provide\* with lifecycle-bound disposal. AgentDispatcher
  is now owned by OrchestrationKernel instead of a global singleton.
  AIService removes chat/chatStream/ask methods (use completeText).
  New spawn-delegation module detects async vs sync spawn_task results.
  KeyedMutex utility added for per-key async serialization.

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- 36c7400: Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

  Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.

- a9fa72e: Make Context System builders and injectors consume canonical Turn identity rather than Core IM `Message`. Schedule context is now selected explicitly from the Turn origin, uses a native Schedule session/principal projection, and fails closed when the job identity is absent.
- c8de3ef: Replace Home Assistant's legacy `ZhinTool` and IM `Message` execution boundary with native generation-owned Agent Tool definitions. Home authorization now consumes the authenticated canonical tool principal, and the CLI publishes Home tools only through the Tool Feature projection.

  Configured Agent and Home candidate initialization now fail closed instead of publishing a generation with the requested capability silently absent.

- 60f0fc8: Route production IM Agent turns through the Root-owned `AgentRuntime` and the
  generation-owned full `AgentTurnEngine`. Add canonical deferred capability
  loading for projected tools and skills, keep policy/audit execution under the
  turn authority, and remove the production `ZhinAgent.processTurn` bridge.
- 574c990: Replace Message-based passive group context APIs with canonical session/principal observations, remove the deprecated append API, and make TurnIngress session preparation drain passive context by its fixed session identity.
- d096f16: Replace schedule management tools' legacy `ZhinTool` and IM `Message` boundary with native Agent Tool definitions and canonical invocation identity. Schedule creation now derives creator and delivery target from the authenticated tool principal and origin.

  Remove the process-global Schedule manager registry. Every generated Schedule Tool set closes over its own generation manager, preventing in-flight old-generation turns from crossing into a newer engine.

- 3f29623: Require every Tool invocation to carry immutable permission, unattended, and network policy into `ToolExecutionContext`. Tool transports can now enforce the exact fixed-Turn authority at each side-effect boundary without process-global execution context.
- 2916852: Make canonical invocation origin and principal display identity part of every
  Tool execution context. IM, HTTP, A2A, Schedule, Internal, and MCP callers now
  carry structured origin data through ToolIndex instead of requiring tools to
  read a legacy IM Message side channel.
- d047869: Make the canonical Turn Tool Runtime enforce file and Bash policy before execution. File writes, sensitive reads, unsafe shell commands, shell mutations, and shell reads of sensitive paths now use the shared policy facade and fail closed from authenticated Turn principal roles.
- 162fa34: Publish `ask_user` as a generation-owned ToolFeature backed by a Root-owned, origin-neutral InteractionRouter.

  Tool execution now receives an optional turn-scoped QuestionPort. The IM composition root binds that port to the canonical session and authenticated sender, and ImRuntime can claim pending interaction replies before middleware, commands, or Agent fallback. Invalid replies use the current message's delivery authority; the router never retains an expired Runtime Message or Adapter handle. Missing interactive authority, ambiguous sessions, delivery failures, cancellation, and Root shutdown fail closed.

  BREAKING CHANGE: canonical Agent turns no longer rely on Plugin Prompt middleware or mutable global ask-user registries for `ask_user`. Ingress adapters that support interactive questions must provide a QuestionPort; unattended turns cannot expose one.

- e62561e: Replace Message-based inbound media resolution with canonical `TurnMedia` processing. IM segment fallback and platform references are projected only by the ingress adapter before media materialization, transcription, and model injection.
- 3eeeb46: Add explicit, fail-closed network authority to canonical Turn policy. Web tools and Bash network commands are denied unless the Turn grants network access; URL-bearing operations enforce absolute URLs, HTTPS constraints, SSRF protection, and domain allowlists before execution.
- 85d0f82: Require an explicit immutable Agent prompt profile for interactive and Schedule Turns. Prompt assembly no longer discovers Schedule mode from ambient storage or borrows synthetic IM platform/session fields, and the unused fast-path prompt API has been removed.
- 61bfc1c: Fail closed on Agent session and context persistence failures. Database errors now surface as typed `PersistenceUnavailableError` instead of being reinterpreted as Not Found, empty history, or successful metadata writes.

  Make `ContextRepository` the sole Agent session archive authority and remove the duplicate Store archive command that previously reported false after a successful archive.

- 04bad47: Fail closed when a required tool execution fact cannot be written to the Turn
  Journal. Journal integrity failures now abort the model loop and return the
  stable `turn_journal_commit_failed` outcome instead of becoming tool output.
- e40b048: Require generation leases at the IM ingress route instead of exposing a bare
  snapshot. Snapshot leases are store-owned, expose their active state, and can
  be rejected when presented to an Agent Runtime attached to another Root.

  Project configured MCP clients into the generation lifecycle. Configured
  servers must become ready during candidate activation; activation failure is
  fail-closed and leaves the previous generation serving traffic. Agent bindings
  filter the MCP servers visible to a turn, and MCP tools use owner-qualified
  `${qualifiedServer}__${tool}` names with fail-closed approval metadata.

- 5a5b1bb: Resolve the complete Agent Turn engine from the fixed generation snapshot instead of capturing a constructor callback. `AgentRuntime` now fails closed when the active generation does not provide `agentTurnEngineToken`.
- f1708c3: 将彩票 Agent 工具迁入正式 `tools/*.ts` ToolFeature 约定目录。

  删除已移除的 `AgentToolsHost` 动态注册桥与 `agent/runtime-tools` 中间层；工具现在由 Plugin Runtime 在候选 generation 中发现，并由标准 prepack 构建器生成可发布的 JavaScript 入口。

  Agent capability catalog 现在发布全树、owner-qualified 的 Tool identity（例如 `lottery__history`），避免子插件工具不可见及跨 owner 同名碰撞；执行边界会运行 Zod-like `safeParse` schema，非法输入在进入工具前 fail-closed。

  Lottery 的 Tool、Command、pipeline 与 outbound 全部从 owner capability runtime 读取资源；删除进程级 DB、Agent deps、push 注册表和 fallback，多实例与跨 generation 执行因此保持隔离。插件将 `zod` 声明为真实运行时依赖，保证 ToolFeature 在不安装 Agent 的合法部署中也可被发现。

  Tool approval 的 `on-risk` 语义现在完整贯穿 Core transport 与 Agent approval gate，不再在 Plugin Runtime capability 投影中丢失。

- d254a81: Publish the built-in file capability family as native, generation-owned ToolFeatures on the canonical IM Turn path.

  File execution now requires explicit Turn workspace authority. The shared policy facade canonicalizes existing targets, symlinks, and missing write targets before checking workspace containment and sensitive paths, then passes that exact authorized input to the executor. Missing authority, home-relative paths, directory escape, and symlink escape fail closed. Native read, write, edit, list, glob, and grep tools consume ToolExecutionContext and AbortSignal directly; glob and grep no longer spawn shell commands.

  BREAKING CHANGE: `runTurnToolPolicies` is asynchronous and successful/approval decisions carry the authorized input. `createRuntimeTurnRequest` requires `workspaceRoot`, and canonical file tools no longer permit paths outside that workspace.

- 7123c47: Publish `web_fetch` and `web_search` as native generation-owned ToolFeatures on the canonical IM Turn path.

  Both tools now use one Turn-scoped network module that authorizes every redirect hop, rejects non-public DNS results, pins the socket connection to the reviewed address while preserving HTTPS SNI and Host, enforces cancellation, timeout, redirect, and response-size limits, and records transport policy rejection as a canonical denied tool event. Interactive IM turns receive HTTPS authority only from the explicit `network` execution preset.

  BREAKING CHANGE: the canonical web tools no longer consume ambient AsyncLocalStorage network policy or automatic fetch redirects. Deployments must explicitly select the `network` preset, and non-public or non-HTTPS targets fail closed.

- 05befc1: Make Agent session persistence origin-neutral. `agent_sessions` now stores only Agent session identity and lifecycle metadata; IM platform, endpoint, and scene fields remain exclusively in the IM transcript/session projection. HTTP, A2A, Schedule, and internal Turns can open Agent sessions without fabricating IM identities.
- 0663b6a: Make the public Turn Context Envelope consume canonical Turn origin, principal, and session data instead of IM `Message`. IM metadata is now validated and projected only by the ingress adapter, while Schedule, HTTP, A2A, and internal Turns describe their native origins without fabricated platform fields.
- f28f9b3: Remove ambient mutable Schedule state from the Agent turn context. Schedule authority now flows explicitly through the existing Context, Prompt, and Tool pipelines, while Schedule feedback events publish their job identity directly from TaskExecutor instead of mirroring it through legacy plugin-event ALS.
- 9f340f7: Delete the classic Plugin/Message-based `ask_user` implementation and its global pending-session middleware.

  Interactive clarification now has one authority: the generation-owned `ask_user` ToolFeature and turn-scoped QuestionPort. Security approval remains a separate, explicit ApprovalPort and fails closed when the ingress does not provide one. AIService no longer accepts a Plugin to inject interactive tools, classic built-in aggregation no longer publishes `ask_user`, and post-tool owner prompting no longer bypasses the approval boundary.

  BREAKING CHANGE: `AskUserBuiltinTool`, `AskUserSessionService`, `createAskUserTool`, `AIService.setPlugin`, `ImApprovalAdapter`, `SessionInteractionPort`, and owner hard-orchestration exports are removed. Hosts must provide QuestionPort for ordinary questions and ApprovalPort for security decisions.

- e53444f: refactor!: 架构债第二轮（asPrivate 零强转、窄接口域拆分、JSX 全局冲突根治、测试面真迁移）

  - **agent**：`asPrivate` 强转彻底去除——门面类与 `ZhinAgentPrivate` 全量对齐，编译期校验恢复；接口按域拆窄（`AgentSessionHost` / `AgentContextHost` / `AgentTurnLifecycleHost` / `AgentEmitterHost`）；`HostPromptController.schedule` 伪泛型修正（toolCalls 收紧为 `ToolCallRecord[]`）；零调用门面成员删除。
  - **core + satori**：两处全局 `JSX.Element` 声明改为模块作用域 `export namespace JSX`（语义不同的两套 JSX 模型不再互斥），`zhin.js/jsx-runtime` 类型前转补齐；examples components 回归 type-check 编译面。
  - **ai**：OpenAI wire 类型（`ChatCompletionRequest/Response/Choice`、`ToolDefinition`/`ChatToolDefinition`）与 **`ContentPart` 本体及全部 shim**（`processMultimodal`、`normalizeContentPartsToPayloads`、`summarizeContentParts`、`prepareMultimodalBlocks`、`createInboundTurnPipeline` 兼容门面）从公共面彻底删除——agent 测试 mock 已迁 ai-sdk 原生面（`wireMockLlmApi` 直注册 ai-sdk stream，断言面收敛到 AgentMessage 层）；`ChatMessage.content` 收窄为 `string`；891 行死沙箱 `sandbox-enhanced.ts` 连文件删除；init 镜像入口的 `as unknown as` 强转消除。

  BREAKING CHANGE：上述公共导出收窄项；JSX 全局命名空间不再由 `@zhin.js/core`/`@zhin.js/satori` 提供（经 jsxImportSource 的消费链不受影响）。

- 5eedd26: Publish `todo_read` and `todo_write` as native generation-owned ToolFeatures backed by a session-addressed, crash-safe TodoStore.

  The canonical session key is now the only TODO identity. Storage filenames are hashes, replacements are serialized and atomically renamed, aborted writes are never published, and model input cannot select a chat identifier or filesystem path. `.zhin/` is now runtime-private state and generic file tools cannot read or enumerate journals, TODO documents, or other authority-owned files.

  BREAKING CHANGE: `todo_read` and `todo_write` no longer accept `chat_id`; TODO state is isolated by the canonical Turn session and moved to `.zhin/todos`.

- 92b0dd7: refactor: complete plugin dual-track elimination (Slices 3–4)

  Remove all `getHostRootPlugin()` call sites (30+ occurrences across security,
  collaboration, media, memory, prompt, and orchestrator modules); dead branches
  collapse to defaults/fallbacks. Expand harness to ban `getHostRootPlugin()` in
  all packages.

  Stub `initAgentModule()` and `registerAI()` as throwing — the Plugin Runtime
  (`zhin runtime start`) is the sole entry path; `basic/cli` assembles the Agent
  stack directly.

  Mark `PluginBase.provide()` / `.inject()` as `@deprecated @internal`; the
  service bus is superseded by Scope + Token (introduced in Slice 2).

  Simplify `host-plugin-registry.ts` to minimal no-op signatures. Move
  `AIServiceRefs` type to `internal/` so live collaboration/orchestrator code
  no longer depends on dead `init/` modules.

  Clean `setHostRootPlugin` / `getHostRootPlugin` mocks from 8 test files;
  update agent README to remove `initAgentModule` usage examples.

- f919b6f: Add one Turn Event source module that owns concurrent worker-to-stream bridging,
  exactly-once terminal emission, error mapping, and worker settlement. Reuse it
  from the existing streaming turn path so future IM ingress adapters do not
  reimplement event queues or release generation leases while work is active.

  Agent surface diagnostics now include root `tools/` convention entries as well
  as `agent/tools/`, matching Plugin Runtime discovery.

- 098e411: Schedule the canonical Agent `TurnEvent` stream through `PromptController` and
  persist synthesized failure, cancellation, and missing-terminal facts before
  returning a `TurnOutcome`.
- e1b7c01: Commit the durable Agent terminal before conversation, session, metrics, and IM
  reply projections. Projection failures are isolated diagnostics and cannot
  rewrite the committed `TurnOutcome`.
- 9b94f87: Replace Message-keyed deferred tool state with a turn-owned deferred controller. Deferred meta tools are now created by the Agent turn, concurrent turns and subagents receive isolated state, and the legacy WeakMap binding API has been removed.
- a7df753: refactor!: Wave 2 架构债清理（ContentPart 终结 + 死面清剿 + agent 结构收敛）

  **AI 层**

  - `preprocessInboundMedia` / `buildSubagentInboundTask` 入参收窄为 canonical 单形态（ContentPart union 臂删除）。
  - 删除死面：`INBOUND_MEDIA_PARTS_EXTRA_KEY`、`userMessageToFilterText`、tool-policy `always/once/never` 别名、ContentPart `face` 变体、`describeVisionPartsAsText`；`processMultimodal` 等公网 shim 标 `@deprecated`（下个大版本删除）。
  - 测试桥归位：`createOpenAiCompletionsStreamFn` 及 wire 转换器移出公共 API（入 agent 测试目录）；`openai-bridge` 只剩 `assistantText`；`legacy-tool-bridge.ts` 正名 `tool-bridge.ts`。
  - 类型修复：`ModelApi = 'ai-sdk' | (string & {})`；`AgentTool.execute` 与实现对齐为三参（删 `as` 强转）。

  **core 层**

  - 死导出整批删除（均零引用）：`AITool`、撞名 `ToolDefinition`、`NoticeType/RequestType`、Interactive 别名全簇、`PermissionService`/`ConfigService` 别名、`getLiveEndpoint`、`qrcode-segment` 整文件；热路径不再自用 deprecated 别名（`resolveInteractiveSegments` 删除，改 `resolveKeyboardSegments`）。
  - im-contract 双 legacy 格式化函数二合一（`formatLegacyMessageRef` 为唯一公开 API）；ai-outbound 的 legacy `kind` 回退分支删除。

  **agent 层**

  - `ZhinAgentPrivate` 58 → 43 成员：死成员/零读取成员删除，deferred 族收敛为 `DeferredTurnState` 模块，三份手工镜像改为权威接口 Pick，`readonly` 名不副实纠偏，AutoContinueHost 单参化。
  - 4 个值导入循环解环（纯函数下沉 collab-utils / ask-user-format / memory-layers）；prompt 双轨收敛（3 个零调用导出 + 死分支删除）；死文件删除；`sandbox-enhanced` 挂 `@deprecated` 摘出公共导出；`tokenUsageToLegacy` 合一、`AGENT_ROLE_CONFIGS` 拆表。

  BREAKING CHANGE：上述删除项均为公共导出面的收窄，详见各条。

- Updated dependencies [c106ecc]
- Updated dependencies [b0f37ae]
- Updated dependencies [c50aca3]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [162fa34]
- Updated dependencies [61bfc1c]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [05befc1]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/permission@1.0.1
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/core@1.5.4
  - @zhin.js/ai@1.5.2
  - @zhin.js/tool@1.0.8
  - @zhin.js/mcp-feature@1.0.8
  - @zhin.js/kernel@1.0.7
  - @zhin.js/agent-feature@1.0.8
  - @zhin.js/skill@1.0.8

## 1.1.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/schedule@0.0.5
  - @zhin.js/agent-feature@1.0.7
  - @zhin.js/ai@1.5.1
  - @zhin.js/core@1.5.3
  - @zhin.js/kernel@1.0.6
  - @zhin.js/mcp-feature@1.0.7
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/skill@1.0.7
  - @zhin.js/tool@1.0.7

## 1.1.3

### Patch Changes

- 2e41ad5: fix: agent 优化
- Updated dependencies [afc0e66]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/agent-feature@1.0.6
  - @zhin.js/mcp-feature@1.0.6
  - @zhin.js/skill@1.0.6
  - @zhin.js/tool@1.0.6

## 1.1.2

### Patch Changes

- 696ab1b: fix(agent): subagent 延迟加载工具执行报 "Unknown tool" + 父会话 snapshot 污染

  子 Agent / standalone loop 此前只有静态工具集：`load_tool` 报"加载成功"（写 snapshot）但 executor 找不到新加载的工具，模型反复重试空耗 token（实测 15 轮 77s 无法识别图片）。修复：

  - standalone loop 接入与主 loop 相同的延迟加载机制：`load_tool` 命中后从 catalog 并入完整工具、重建 schema 并补全一轮（`refreshTools` + `shouldRecompleteAfterTool`）。
  - deferred runtime 增加 AsyncLocalStorage 隔离通道：子 loop 的 snapshot 从父会话克隆（可见父已加载工具），但其 `load_tool` 变更只活在本 loop，不再写父会话 snapshot。

## 1.1.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/agent-feature@1.0.5
  - @zhin.js/core@1.5.1
  - @zhin.js/mcp-feature@1.0.5
  - @zhin.js/skill@1.0.5
  - @zhin.js/tool@1.0.5

## 1.1.0

### Minor Changes

- 5b94d9c: refactor!: 清除 AI 双栈残留（BREAKING，无兼容层）

  - **删除 legacy 直连 HTTP Provider 栈**：`@zhin.js/ai` 的 `providers/` 目录（OpenAI/Anthropic/Ollama/DeepSeek/Google/Cloudflare/Zhipu/Moonshot 及 openai-sse/base）整体移除。生产 provider 实例早已统一经 `createSdkProviderAdapter`（AI SDK 传输）创建，旧栈为零调用死代码；Provider 类与 `OpenAIConfig` 等配置类型导出同步删除。图像生成走 `SdkProviderAdapter.generateImage`（ai-sdk-image 桥）。
  - **删除已死的 collaboration 入站管线**：`createInboundTurnPipeline` 及其 enrich/route/execute/outbound-stage、`registerAiTrigger`、`extractMediaParts`（旧 `$content` 形状读取）、`processMultimodalTurn` 主实现。`ZhinAgent.processMultimodal` 保留为薄 shim（委托 canonical 路径）；`createInboundTurnPipeline` 保留薄门面（内部走 `agent.process`）。
  - **媒体面统一到 canonical MediaRef**：新增 `normalizeMediaRefsToPayloads`（url fetch / path 读盘 / base64 直取 / 大小预检），orchestrator（bootstrap-executors）、subagent-inbound、analyze-media-tool 全部改吃 canonical refs；`payloadToVisionPart` 产出 `MediaContentBlock`；`normalizeMatchRules` 拆分为独立模块 `routing/match-rules`（行为不变）。

  迁移：若仍从 `@zhin.js/ai` import 具体 Provider 类（如 `OpenAIProvider`），改为配置驱动（`ai.providers` + `createSdkProviderAdapter`）。

### Patch Changes

- 4fbff5d: feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

  全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

  - **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
  - **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
  - **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
  - **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
  - **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

  迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。

- Updated dependencies [1f23bf6]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/ai@1.5.0
  - @zhin.js/core@1.5.0

## 1.0.10

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/ai@1.4.8
  - @zhin.js/core@1.4.3

## 1.0.9

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3

## 1.0.8

### Patch Changes

- f346346: fix: 未配置 outputSchema 时不再对 AI SDK `result.output` 做 JSON.stringify，避免 IM 回复出现整段双引号与字面量 `\n`（#590）；出站侧额外解开误包的 JSON 字符串层
- Updated dependencies [f346346]
  - @zhin.js/ai@1.4.7
  - @zhin.js/core@1.4.2

## 1.0.7

### Patch Changes

- @zhin.js/agent-feature@1.0.4
- @zhin.js/mcp-feature@1.0.4
- @zhin.js/skill@1.0.4
- @zhin.js/tool@1.0.4
- @zhin.js/core@1.4.2

## 1.0.6

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

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [f0ec5ab]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/tool@1.0.3
  - @zhin.js/mcp-feature@1.0.3
  - @zhin.js/ai@1.4.6
  - @zhin.js/schedule@0.0.4
  - @zhin.js/core@1.4.1
  - @zhin.js/agent-feature@1.0.3
  - @zhin.js/skill@1.0.3
  - @zhin.js/kernel@1.0.5

## 1.0.5

### Patch Changes

- 3ea84a0: Plugin Runtime 插件 agent 工具接线：新增 `agentToolsHostToken`（generation 作用域的 Agent Tools Host），插件 `setup()` 可经闭包向 Agent Host 注册工具（桥接 zod inputSchema → JSON parameters + execute 前校验），解决 Runtime 下插件 `agent/tools` 不被发现、`lottery agent deps not initialized` 的问题。lottery 7 个 `lottery_*` 工具已按此接线（`agent/runtime-tools.ts`）；`/api/introspection/tools` 合并 agent 注册工具。
- 1ddcd70: Console/契约扫尾批：

  - adapter：多 endpoint record name 改为 entry.name（Console 展示/resolve/inbox 按名唯一命中）；`expandEndpointConfigs` 增加缺名/非法字符/重名校验与告警；slack endpoint 补 `name` getter；inbox-installer / agent-host 解析 `slot~entry` 展开 id（activity-feedback 随之恢复）。
  - host-http：`schema:get`/`config:get` 兼容 `data.plugin`；extended RPC 参数顶层与 `data` 合并（cron 写操作修复）；请求审批认 `requestId`、已读认单值 `id`；`endpoint:requests`/`inboxRequests`/`inboxNotices` 行补 camelCase/扁平别名；cron 列表补 `expression/running/plugin/nextExecution/createdAt/context`。
  - cli：装配 `setOrchestrationRuntime`/`setSessionTreeRuntime`（agent-sessions/orchestration 页恢复）；`/api/stats` 补 commands/components 计数；console REST databaseHost.started 改动态 getter；`wrapModel` 支持 orderBy/limit 链式查询；接线 SystemLog 模型 + 日志 transport（logs 页有真实数据，带 7 天/1 万条清理）。
  - plugin-runtime：`DatabaseHostModel.select` 升级为链式 `DatabaseHostSelection`；新增 `system-log`（SystemLog 表定义/写入助手）。
  - agent：导出 `asPrivate`（Runtime Host 装配 session tree runtime 用）。

- Updated dependencies [7db69c1]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent-feature@1.0.2
  - @zhin.js/mcp-feature@1.0.2
  - @zhin.js/skill@1.0.2
  - @zhin.js/tool@1.0.2

## 1.0.4

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

- 447f3e2: 迁移缺口修复（legacy 功能对齐）：

  - html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
  - 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
  - im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
  - `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
  - `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/schedule@0.0.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/kernel@1.0.4
  - @zhin.js/ai@1.4.5
  - @zhin.js/agent-feature@1.0.1
  - @zhin.js/mcp-feature@1.0.1
  - @zhin.js/skill@1.0.1
  - @zhin.js/tool@1.0.1

## 1.0.3

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/core@1.3.4
  - @zhin.js/kernel@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/schedule@0.0.2
  - @zhin.js/ai@1.4.4

## 1.0.2

### Patch Changes

- 5b08052: fix: 架构优化
- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- b9b3881: fix: 增加游戏引擎以及部分游戏
- 7700903: fix: 游戏强化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/kernel@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/logger@1.0.73
  - @zhin.js/schedule@0.0.1
  - @zhin.js/ai@1.4.3

## 1.0.1

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- c4575c9: Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/core@1.3.2
  - @zhin.js/ai@1.4.2
  - @zhin.js/logger@1.0.72

## 1.0.0

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.3.1)

## 0.3.1

### Patch Changes

- 609da24: fix: 规范安全开发
- 7dfafc2: fix: ai 提示词缓存优化
- 93e58d9: refactor: 网络策略统一、core 导出整理、Disposable 接口、Bot 图标修复

  - 新增 `security/network-policy.ts` 统一 SSRF 防护、域名匹配、网络命令检测
  - `core/index.ts` 移除死导出、统一结构
  - 新增 `Disposable` 接口替代 `as any` dispose 调用
  - `bridge.ts` MCP inputSchema 类型安全
  - 脚手架依赖版本锁定（latest → ^major.minor.0）
  - 修复 icqq/sandbox 客户端缺失 Bot 图标导入

- ae5239c: fix: 核心包瘦身
- Updated dependencies [609da24]
- Updated dependencies [7dfafc2]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/core@1.3.1
  - @zhin.js/ai@1.4.1

## 0.3.0

### Minor Changes

- db38da4: refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

  - Delete legacy `Agent` class and its tests from `@zhin.js/ai`
  - Extract `userMessageToFilterText()` as standalone utility
  - Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
  - Remove Agent-related re-exports from ai/agent/core/zhin packages
  - Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/ai@1.3.0
  - @zhin.js/core@1.3.0

## 0.2.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/core@1.2.1
  - @zhin.js/ai@1.2.1
  - @zhin.js/logger@0.1.71

## 0.2.0

### Minor Changes

- 65f4b0a: 架构优化、类型安全提升与构建系统清理

  **kernel** (minor)

  - PluginBase.start() 提取 `mountAllContexts()` / `mountContext()` 可覆盖钩子

  **core** (minor)

  - Plugin.start() 覆盖 `mountAllContexts()` 支持 Context 挂载失败回滚
  - Plugin.stop() 委托 `super.stop()` 消除重复代码
  - Lifecycle 事件类型化：message.receive → Message, request.receive → Request, notice.receive → Notice

  **ai** (minor)

  - BaseProvider 提取 `request()` 公共方法，消除 fetch/fetchText/fetchStream 80% 重复代码
  - 修复 fetch/fetchText 的 AbortController 泄漏

  **agent** (minor)

  - 为 7 个模块级单例添加 reset() 函数支持测试隔离
  - 修复 8 处 `catch (e: any)` → `catch (e: unknown)`

  **host-api / plugins** (patch)

  - handlers-db.ts 移除 11 处 `as never` cast，修复 11 处 catch 类型标注
  - adapter-github / plugin-group-suite / plugin-rss 移除 inject() 的 `as any` cast

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.
- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/core@1.2.0
  - @zhin.js/ai@1.2.0

## 0.1.31

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/core@1.1.33
  - @zhin.js/ai@1.1.31

## 0.1.30

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/core@1.1.32
  - @zhin.js/ai@1.1.30

## Unreleased

### Minor Changes

- **Assistant Runtime（路线 A）**：M1–M5 统一 JobStore、Event Ingress、NotificationRouter、Home Domain、Assistant Profile
  - `assistant.enabled` opt-in；`assistant-jobs.json` SSOT
  - `POST /api/assistant/events`、`GET /api/assistant/jobs`
  - `home_*` 工具、`assistant.profile.yml` Bootstrap 合并
  - `notify.channel` 多通道；`cron_add notify_channel` 参数
  - Profile `morningBrief` / `bedtimeCheck` cron routines → JobStore
  - `assistant.queue` TaskQueue（重试 / 并发 / 死信）
  - `syncSchedulerJobsFromLegacy`；assistant.enabled 时关闭 legacy Scheduler
  - `assistant.home.mcpServer` 与 `ai.mcpServers` 校验；Profile 设备别名合并
  - `CronJobContext` / `context` 已移除（破坏性）；`cron-jobs.json` / `assistant-jobs.json` 必须含 `notify`
  - `zhin cron add --notify-channel`；Console RPC `cron:add` 使用 `notify` / `notifyChannel`（默认 silent）
  - `legacyDualWrite` 默认 false

## 0.1.29

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- c8f8207: fix: 增加重启恢复会话功能
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
  - @zhin.js/logger@0.1.70
  - @zhin.js/ai@1.1.29
  - @zhin.js/core@1.1.31

## 0.1.28

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/core@1.1.30
  - @zhin.js/ai@1.1.28

## 0.1.27

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/core@1.1.29
  - @zhin.js/ai@1.1.27

## 0.1.26

### Patch Changes

- 6295cbd: fix: @优化
- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/core@1.1.28
  - @zhin.js/logger@0.1.68
  - @zhin.js/ai@1.1.26

## 0.1.25

### Patch Changes

- b0e0a71: fix: 提示词优化,create-zhin 引导优化
  - @zhin.js/logger@0.1.67
  - @zhin.js/core@1.1.27
  - @zhin.js/ai@1.1.25

## 0.1.24

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/core@1.1.26
  - @zhin.js/logger@0.1.66
  - @zhin.js/ai@1.1.24

## 0.1.23

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/core@1.1.25
  - @zhin.js/logger@0.1.65
  - @zhin.js/ai@1.1.23

## 0.1.22

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/ai@1.1.22
  - @zhin.js/core@1.1.24

## 0.1.21

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/core@1.1.23
  - @zhin.js/ai@1.1.21

## 0.1.20

### Patch Changes

- 3b3e49b: fix: ask 工具修复,icqq skill 优化
  - @zhin.js/core@1.1.22
  - @zhin.js/ai@1.1.20

## 0.1.19

### Patch Changes

- 92da96d: fix skill 激活优化
  - @zhin.js/core@1.1.21
  - @zhin.js/ai@1.1.19

## 0.1.18

### Patch Changes

- 88caeb2: fix: ask user 护栏
- Updated dependencies [88caeb2]
  - @zhin.js/core@1.1.20
  - @zhin.js/ai@1.1.18

## 0.1.17

### Patch Changes

- fcad030: fix: agent ai 优化
- Updated dependencies [fcad030]
  - @zhin.js/ai@1.1.17
  - @zhin.js/core@1.1.19

## 0.1.16

### Patch Changes

- cb9fbf1: fix: ai 增强
- Updated dependencies [cb9fbf1]
  - @zhin.js/ai@1.1.16
  - @zhin.js/core@1.1.18

## Unreleased

### Changed

- 子代理默认继续使用最小工具继承（不自动继承主会话 skill/tool）；可通过 `ai.agent.subagentTools` 显式追加子代理可用工具白名单。

## 0.1.15

### Patch Changes

- Updated dependencies [efad4ef]
  - @zhin.js/ai@1.1.15
  - @zhin.js/core@1.1.17

## 0.1.14

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - @zhin.js/core@1.1.16
  - @zhin.js/ai@1.1.14

## 0.1.13

### Patch Changes

- 63d0b88: fix: 定时任务优化
  - @zhin.js/core@1.1.15
  - @zhin.js/ai@1.1.13

## 0.1.12

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/ai@1.1.12
  - @zhin.js/core@1.1.14

## 0.1.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/ai@1.1.11
  - @zhin.js/core@1.1.13

## 0.1.10

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - @zhin.js/ai@1.1.10

## 0.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
- Updated dependencies [0eba6d6]
  - @zhin.js/core@1.1.9
  - @zhin.js/ai@1.1.9

## 0.1.8

### Patch Changes

- 9aa08c3: fix: ai 增强
- Updated dependencies [9aa08c3]
  - @zhin.js/ai@1.1.8
  - @zhin.js/core@1.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/core@1.1.7

## 0.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/ai@1.1.6
  - @zhin.js/core@1.1.6

## 0.1.5

### Patch Changes

- ba30934: fix: web 优化
  - @zhin.js/core@1.1.5
  - @zhin.js/ai@1.1.5

## 0.1.4

### Patch Changes

- bf0dc75: fix: 幻觉优化
  - @zhin.js/core@1.1.4
  - @zhin.js/ai@1.1.4

## 0.1.3

### Patch Changes

- a257f3f: fix: 定时任务提示词优化
  - @zhin.js/core@1.1.3
  - @zhin.js/ai@1.1.3

## 0.1.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/core@1.1.2
  - @zhin.js/ai@1.1.2

## 0.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/ai@1.1.1
  - @zhin.js/core@1.1.1

## 0.1.0

### Minor Changes

- 8280fe7: feat: ModelRegistry 模型自动发现与智能选择

  - 新增 ModelRegistry：自动发现 Provider 可用模型，Tier 评分（0-100）智能排序
  - 支持 Ollama 详细元数据（参数量、量化）和 OpenAI 兼容 API 启发式推断
  - 支持 API 聚合/中转服务的 prefix/model-name 格式（如 9router）
  - providers.models 配置现为可选 — 框架自动发现并按评分排序
  - 新增 chatModel / visionModel 配置项，留空自动选择最优模型
  - 自动模型降级：Chat / Vision / Agent 三条路径均支持失败自动切换
  - Agent 新增 modelFallbacks 配置和 chatWithFallback() 降级引擎

### Patch Changes

- Updated dependencies [8280fe7]
  - @zhin.js/core@1.1.0
  - @zhin.js/ai@1.1.0

## 0.0.20

### Patch Changes

- c606a57: fix: ask_user 优化
- Updated dependencies [c606a57]
  - @zhin.js/core@1.0.57
  - @zhin.js/ai@1.0.18

## 0.0.19

### Patch Changes

- 20ab379: fix: ai 优化
- Updated dependencies [20ab379]
  - @zhin.js/ai@1.0.17
  - @zhin.js/core@1.0.56

## 0.0.18

### Patch Changes

- 75709e1: fix: ai 强化,文档梳理
- Updated dependencies [75709e1]
  - @zhin.js/core@1.0.55
  - @zhin.js/ai@1.0.16

## 0.0.17

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/ai@1.0.15
  - @zhin.js/core@1.0.54

## 0.0.16

### Patch Changes

- @zhin.js/core@1.0.53
- @zhin.js/ai@1.0.14

## 0.0.15

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - @zhin.js/ai@1.0.13

## 0.0.14

### Patch Changes

- 607acc4: fix: 视觉模型处理
  - @zhin.js/core@1.0.51
  - @zhin.js/ai@1.0.12

## 0.0.13

### Patch Changes

- 2510365: fix: 文件安全拦截
  - @zhin.js/core@1.0.50
  - @zhin.js/ai@1.0.11

## 0.0.12

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/core@1.0.49
  - @zhin.js/ai@1.0.10

## 0.0.11

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/core@1.0.48
  - @zhin.js/ai@1.0.9

## 0.0.10

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/core@1.0.47
  - @zhin.js/ai@1.0.8

## 0.0.9

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/ai@1.0.7
  - @zhin.js/core@1.0.46

## 0.0.8

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - @zhin.js/ai@1.0.6

## 0.0.7

### Patch Changes

- 4f2fb55: fix: agent bug
  - @zhin.js/core@1.0.44
  - @zhin.js/ai@1.0.5

## 0.0.6

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/core@1.0.43
  - @zhin.js/ai@1.0.4

## 0.0.5

### Patch Changes

- 0999ca6: fix: 提示词优化,60s 技能优化
- Updated dependencies [0999ca6]
  - @zhin.js/ai@1.0.3
  - @zhin.js/core@1.0.42

## 0.0.4

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - @zhin.js/ai@1.0.2

## 0.0.3

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/core@1.0.40
  - @zhin.js/ai@1.0.1

## 0.0.2

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
- Updated dependencies [04f76ac]
  - @zhin.js/core@1.0.39

## 0.0.1

### Patch Changes

- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
