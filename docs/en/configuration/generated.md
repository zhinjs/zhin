---
title: Generated configuration field reference
outline: [2, 3]
---

# Generated configuration field reference

> Generated from runtime source and JSON Schema. Do not edit manually. See [Configuration](./) for narrative guidance and examples.

- Generator: `pnpm docs:config`
- Drift check: `pnpm check:config-reference`

## Host top-level fields

The authoritative contract is [`packages/im/runtime/src/host-config-schema.json`](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json), consumed by the Runtime at [`basic/cli/src/plugin-runtime/console/configuration-projection.ts`](https://github.com/zhinjs/zhin/blob/main/basic/cli/src/plugin-runtime/console/configuration-projection.ts).

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `http` | object | no | — | HTTP, Console, REST/RPC/SSE, and Webhook Host. |
| `http.readiness` | object | no | — | Required runtime components for /pub/ready; no external network probes. |
| `http.readiness.database` | boolean | no | `true` | Require an initialized Database Host (not a live database query). |
| `http.readiness.endpoints` | array&lt;object&gt; | no | — | Required Endpoint admission slots, selected by exact plugin owner and stable slot name. |
| `http.readiness.endpoints[].owner` | string | yes | — | — |
| `http.readiness.endpoints[].name` | string | yes | — | — |
| `http.readiness.agents` | array&lt;string&gt; | no | — | Required configured Agent bindings; does not verify model credentials or provider reachability. |
| `http.host` | string \| null | no | — | 监听地址。 |
| `http.port` | number \| string \| null | no | — | 监听端口。 |
| `http.token` | string \| null | no | — | HTTP Host 访问令牌。 |
| `http.tokens` | array \| null | no | — | — |
| `http.corsOrigins` | array \| null | no | — | — |
| `http.base` | string \| null | no | — | API 路径前缀。 |
| `http.tls` | `false` \| null \| object | no | — | — |
| `http.listeners` | array&lt;object&gt; | no | — | — |
| `http.listeners[].enabled` | boolean \| string | no | — | 是否启用此监听器。 |
| `http.listeners[].host` | string | no | — | 监听地址。 |
| `http.listeners[].port` | number \| string | no | — | 监听端口。 |
| `http.listeners[].tls` | `false` \| null \| object | no | — | — |
| `database` | object | no | — | Database Host and dialect connection options. |
| `database.dialect` | string | no | — | 数据库方言。 |
| `database.filename` | string | no | — | SQLite 文件路径。 |
| `database.mode` | string | no | — | SQLite 兼容模式字段。 |
| `database.host` | string | no | — | 数据库主机。 |
| `database.port` | number \| string | no | — | 网络数据库端口。 |
| `database.user` | string | no | — | MySQL / PostgreSQL 用户名。 |
| `database.username` | string | no | — | Redis 用户名。 |
| `database.password` | string | no | — | 连接密码。 |
| `database.database` | string \| number | no | — | MySQL / PostgreSQL 数据库名，或 Redis 数据库索引。 |
| `database.uri` | string | no | — | MySQL 连接 URI（可能含凭据）。 |
| `database.connectionString` | string | no | — | PostgreSQL 连接串（可能含凭据）。 |
| `database.url` | string | no | — | MongoDB / Redis 连接 URL（可能含凭据）。 |
| `database.dbName` | string | no | — | MongoDB 数据库名。 |
| `database.pool` | object \| null | no | — | — |
| `database.pool.min` | number \| string \| null | no | — | 最少连接数。 |
| `database.pool.max` | number \| string \| null | no | — | 最多连接数。 |
| `database.pool.acquireTimeoutMillis` | number \| string \| null | no | — | 获取连接超时毫秒。 |
| `database.pool.idleTimeoutMillis` | number \| string \| null | no | — | 空闲连接超时毫秒。 |
| `database.socket` | object | no | — | — |
| `database.socket.host` | string | no | — | Redis 主机。 |
| `database.socket.port` | number \| string | no | — | Redis 端口。 |
| `database.socket.path` | string | no | — | Unix socket 路径。 |
| `database.socket.connectTimeout` | number \| string | no | — | 连接超时毫秒。 |
| `database.socket.tls` | boolean \| string | no | — | 启用 TLS。 |
| `database.socket.keepAlive` | number \| string | no | — | TCP keep-alive 毫秒。 |
| `database.socket.noDelay` | boolean \| string | no | — | TCP noDelay。 |
| `database.ssl` | boolean \| string \| object | no | — | — |
| `database.charset` | string | no | — | MySQL 字符集。 |
| `database.timezone` | string | no | — | MySQL 时区。 |
| `database.connectTimeout` | number \| string | no | — | MySQL 连接超时毫秒。 |
| `database.connectionTimeoutMillis` | number \| string | no | — | PostgreSQL 连接超时毫秒。 |
| `database.query_timeout` | number \| string | no | — | PostgreSQL 查询超时毫秒。 |
| `database.statement_timeout` | number \| string | no | — | PostgreSQL statement 超时毫秒。 |
| `database.application_name` | string | no | — | PostgreSQL 应用名称。 |
| `database.maxPoolSize` | number \| string | no | — | MongoDB 最大连接池大小。 |
| `database.minPoolSize` | number \| string | no | — | MongoDB 最小连接池大小。 |
| `database.serverSelectionTimeoutMS` | number \| string | no | — | MongoDB server 选择超时毫秒。 |
| `database.connectTimeoutMS` | number \| string | no | — | MongoDB 连接超时毫秒。 |
| `database.socketTimeoutMS` | number \| string | no | — | MongoDB socket 超时毫秒。 |
| `database.authSource` | string | no | — | MongoDB 认证数据库。 |
| `database.replicaSet` | string | no | — | MongoDB 副本集。 |
| `database.auth` | object | no | — | — |
| `database.auth.username` | string | no | — | MongoDB 用户名。 |
| `database.auth.password` | string | no | — | MongoDB 密码。 |
| `database.disableOfflineQueue` | boolean \| string | no | — | Redis 禁止离线队列。 |
| `database.pingInterval` | number \| string | no | — | Redis 心跳间隔毫秒。 |
| `ai` | object | no | — | Providers, Agents, sessions, memory, tools, and execution security. |
| `ai.decisions` | object | no | — | Optional structured-decision service. Missing tasks are off; use shadow before active. |
| `ai.decisions.provider` | string | yes | — | Exact enabled DecisionProvider Plugin owner, such as root/typesafe. |
| `ai.decisions.skills` | object | no | — | — |
| `ai.decisions.skills.mode` | string: `"off"`, `"shadow"`, `"active"` | yes | — | — |
| `ai.decisions.skills.timeoutMs` | integer | no | — | — |
| `ai.decisions.skills.minConfidence` | number | no | — | — |
| `ai.decisions.skills.topK` | integer | no | — | — |
| `ai.decisions.skills.maxCandidates` | integer | no | — | — |
| `ai.decisions.skills.maxSelections` | integer | no | — | — |
| `ai.decisions.tools` | object | no | — | — |
| `ai.decisions.tools.mode` | string: `"off"`, `"shadow"`, `"active"` | yes | — | — |
| `ai.decisions.tools.timeoutMs` | integer | no | — | — |
| `ai.decisions.tools.minConfidence` | number | no | — | — |
| `ai.decisions.tools.topK` | integer | no | — | — |
| `ai.decisions.tools.maxCandidates` | integer | no | — | — |
| `ai.decisions.tools.maxSelections` | integer | no | — | — |
| `ai.decisions.memory` | object | no | — | — |
| `ai.decisions.memory.mode` | string: `"off"`, `"shadow"`, `"active"` | yes | — | — |
| `ai.decisions.memory.timeoutMs` | integer | no | — | — |
| `ai.decisions.memory.minConfidence` | number | no | — | — |
| `ai.decisions.memory.topK` | integer | no | — | — |
| `ai.decisions.memory.maxCandidates` | integer | no | — | — |
| `ai.decisions.memory.maxSelections` | integer | no | — | — |
| `ai.decisions.agents` | object | no | — | — |
| `ai.decisions.agents.mode` | string: `"off"`, `"shadow"`, `"active"` | yes | — | — |
| `ai.decisions.agents.timeoutMs` | integer | no | — | — |
| `ai.decisions.agents.minConfidence` | number | no | — | — |
| `ai.decisions.agents.topK` | integer | no | — | — |
| `ai.decisions.agents.maxCandidates` | integer | no | — | — |
| `ai.decisions.agents.maxSelections` | integer | no | — | — |
| `ai.decisions.approval` | object | no | — | — |
| `ai.decisions.approval.mode` | string: `"off"`, `"shadow"`, `"active"` | yes | — | — |
| `ai.decisions.approval.timeoutMs` | integer | no | — | — |
| `ai.decisions.approval.minConfidence` | number | no | — | — |
| `ai.decisions.approval.topK` | integer | no | — | — |
| `ai.decisions.approval.maxCandidates` | integer | no | — | — |
| `ai.decisions.approval.maxSelections` | integer | no | — | — |
| `ai.workroom` | object | no | — | Process-owned Workroom control-plane policy; Projects remain in the persistent Catalog. |
| `ai.workroom.trustedPackPublishers` | array&lt;string&gt; | no | — | Authenticated Console principal ids allowed to publish shared Capability Packs. |
| `ai.workroom.disclosure` | object | no | — | Explicit P12 model processor contracts for Workroom disclosure bootstrap. |
| `ai.workroom.disclosure.tenantId` | string | no | — | — |
| `ai.workroom.disclosure.modelProviders` | object | no | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.endpoint` | string | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.owner` | string | no | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.trustDomain` | string | no | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.processingRegions` | array&lt;string&gt; | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.maxConfidentiality` | string: `"public"`, `"project_internal"`, `"confidential"`, `"restricted"` | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.external` | boolean | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.noTraining` | boolean | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.loggingMode` | string: `"disabled"`, `"metadata_only"`, `"full"` | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.maximumRetentionSeconds` | integer | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.allowsRedisclosure` | boolean | yes | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.supportsDeletion` | boolean | yes | — | — |
| `ai.agent` | object | no | — | Agent execution, queueing, tool, and model policies. |
| `ai.agent.inboundQueue` | object | no | — | Inbound turn queue policy. |
| `ai.agent.inboundQueue.groupMode` | string: `"supersede"`, `"fifo"` | no | — | supersede (default): a sender's new message replaces their own unanswered turn; fifo: every message waits in arrival order. Other members' messages always queue. |
| `ai.agent.inboundQueue.ttlMs` | integer | no | `180000` | A queued turn that waited longer than this is dropped with a short notice. 0 disables expiry. |
| `ai.agent.inboundQueue.maxQueuedTurns` | integer | no | `5` | Turns allowed to wait behind the running turn of one conversation; further messages get a short busy reply. |
| `ai.agent.inboundQueue.coalesceWindowMs` | number \| string | no | — | — |
| `ai.agent.execSecurity` | string: `"deny"`, `"allowlist"`, `"full"` | no | — | Shell command security boundary. |
| `ai.agent.execPreset` | string: `"readonly"`, `"network"`, `"development"`, `"custom"` | no | — | Command allowlist preset used outside full mode. |
| `ai.agent.network` | object | no | — | Network access for IM turns (web_fetch / web_search and networked commands). Off by default; enabled allows HTTPS egress, optionally limited to allowedDomains. When enabled is unset, execPreset: network still enables it for compatibility. |
| `ai.agent.network.enabled` | boolean | no | `false` | Allow HTTPS egress for IM turns. |
| `ai.agent.network.allowedDomains` | array&lt;string&gt; | no | — | When non-empty, only these domains (and their subdomains) are reachable. |
| `ai.agent.masterShell` | string: `"off"`, `"isolated"` | no | `"off"` | Shell access for the master in IM private chats. off: no bash in IM turns. isolated: master DMs run bash inside a Docker container (workspace writable, no network, development allowlist, approval for anything else); fails closed when Docker is unavailable. |
| `ai.agent.toolBudget` | object | no | — | Progress-aware tool-call budget. maxIterations is a soft budget extended while the turn makes progress; hard caps always apply. |
| `ai.agent.toolBudget.extendBy` | integer | no | `10` | Steps added per extension when progressing; 0 disables. |
| `ai.agent.toolBudget.progressWindow` | integer | no | `5` | Progress must have happened within this many recent steps. |
| `ai.agent.toolBudget.maxTotalIterations` | integer | no | `40` | Hard step cap per turn segment. |
| `ai.agent.toolBudget.maxSubagentTotalIterations` | integer | no | `30` | Hard step cap for an in-turn sub-agent. |
| `ai.agent.toolBudget.maxWallClockMs` | integer | no | `600000` | Wall-clock cap for the whole turn in ms; 0 disables. |
| `ai.agent.toolBudget.maxTotalTokens` | integer | no | `0` | Token cap for the whole turn; 0 disables. |
| `ai.agent.toolBudget.failureStreakLimit` | integer | no | `3` | Consecutive tool failures that stop extensions. |
| `ai.agent.toolBudget.repeatLimit` | integer | no | `2` | Consecutive identical repeated calls that stop extensions. |
| `ai.agent.toolBudget.autoContinue` | string: `"off"`, `"master_dm"`, `"on"` | no | `"master_dm"` | Auto-continue a progressing turn that hit its budget: off, only in the master's private chat, or always. Continuations reuse the same turn (same policy and approvals). |
| `ai.agent.toolBudget.maxContinuations` | integer | no | `2` | Maximum automatic continuations per turn. |
| `ai.agent.toolBudget.progressUpdates` | string: `"off"`, `"private"`, `"all"` | no | `"private"` | Brief natural-language progress updates during long turns: off, private chats only, or all chats (groups opt in). |
| `ai.agent.toolBudget.progressMinIntervalMs` | integer | no | `45000` | Minimum time between progress updates in ms. |
| `ai.agent.toolBudget.progressMaxUpdates` | integer | no | `3` | Maximum progress updates per turn; 0 disables. |
| `ai.agent.injectionGuard` | object | no | — | Prompt-injection defences. After lower-trust content (tool results, web pages, files, sub-agent reports, background messages) enters a turn, high-risk actions (shell, messaging other conversations, config changes, scheduling) need approval; replies are checked for system-prompt, secret and other-session memory leaks. |
| `ai.agent.injectionGuard.confirmHighRisk` | string: `"external_content"`, `"off"` | no | `"external_content"` | external_content: high-risk actions after external content always ask for approval (denied in unattended turns). off: disabled. |
| `ai.agent.injectionGuard.outboundCheck` | string: `"redact"`, `"off"` | no | `"redact"` | redact: mask leaked system-prompt lines, secrets and other sessions' memory in replies and outbound tool messages. off: disabled. |
| `ai.agent.injectionGuard.trustedOutputTools` | array&lt;string&gt; | no | `[]` | Tools whose results do not count as external content. |
| `ai.agent.usageQuota` | object | no | — | Per-user and per-group token quotas and a per-group rate limit. All limits are off (0) by default; the owner is exempt by default. Counters are kept in memory. |
| `ai.agent.usageQuota.windowMs` | integer | no | `86400000` | Quota window in ms. |
| `ai.agent.usageQuota.perUserTokens` | integer | no | `0` | Tokens one user may use per window; 0 = unlimited. |
| `ai.agent.usageQuota.perGroupTokens` | integer | no | `0` | Tokens one group may use per window; 0 = unlimited. |
| `ai.agent.usageQuota.perGroupRequestsPerMinute` | integer | no | `0` | Turns one group may start per minute; 0 = unlimited. |
| `ai.agent.usageQuota.exemptOwner` | boolean | no | `true` | The owner is never limited. |
| `ai.agent.subagentTurnMode` | string: `"off"`, `"sync"` | no | `"off"` | Sub-agents in IM turns. off: no spawn_task. sync: spawn_task runs a sub-agent inside the current turn with at most the parent's permissions (never wider; no bash unless the parent could run it) and approvals routed to the same conversation. |
| `ai.agent.execApprovalMode` | string: `"ask"`, `"bypass"`, `"auto"` | no | — | Approval policy for main Agent commands. |
| `ai.agent.subagentExecApprovalMode` | string: `"ask"`, `"bypass"`, `"auto"` | no | — | Approval policy for sub-Agent commands. |
| `ai.agent.workerExecApprovalMode` | string: `"ask"`, `"bypass"`, `"auto"` | no | — | Approval policy for worker commands. |
| `ai.agent.toolExecution` | string: `"parallel"`, `"sequential"`, `"tiered"` | no | — | How tool calls in one model step are scheduled. |
| `ai.agent.modelSizeHint` | string: `""`, `"small"`, `"medium"`, `"large"` | no | — | Optional model-size hint; an empty string clears the hint. |
| `ai.agent.promptCacheRetention` | string: `"in_memory"`, `"24h"` | no | — | Provider prompt-cache retention policy. |
| `ai.agent.steeringMode` | string: `"one-at-a-time"`, `"all"` | no | — | Process steering messages one at a time or drain all pending messages together. |
| `ai.agent.followUpMode` | string: `"one-at-a-time"`, `"all"` | no | — | Process follow-up messages one at a time or drain all pending messages together. |
| `ai.agent.outputSchema` | boolean \| string: `"segments"` \| object | no | — | Final-output mode: defaults to segments for IM conversations; false for text, true or segments for ordered canonical segments, or a custom JSON Schema object. Detached and non-IM turns do not inherit the IM preset. |
| `ai.agent.schedule` | object | no | — | Unattended Schedule execution policy. |
| `ai.agent.schedule.security` | object | no | — | Schedule command security policy. |
| `ai.agent.schedule.security.execPreset` | string: `"readonly"`, `"network"` | no | — | Schedule Jobs may use only the read-only or network preset. |
| `ai.agent.schedule.security.allowedDomains` | array&lt;string&gt; | no | — | — |
| `ai.agent.schedule.budget` | object | no | — | — |
| `ai.agent.schedule.budget.maxTokens` | number \| string | no | — | — |
| `ai.agent.schedule.budget.maxToolCalls` | number \| string | no | — | — |
| `ai.agent.schedule.budget.timeoutMs` | number \| string | no | — | — |
| `ai.agent.execAllowlist` | array&lt;string&gt; | no | — | allowlist 模式下允许的命令（支持正则字符串，如 "^ls "、"^cat "），与 preset 合并 |
| `ai.agent.phaseTrace` | boolean \| string | no | — | 观测主回合阶段日志（或通过 ZHIN_AGENT_PHASE_TRACE=1 开启） |
| `ai.agent.modelHarness` | object | no | — | 按模型 / provider 模式覆盖 model harness |
| `ai.agent.modelHarness.models` | object | no | — | 模型级覆盖：支持 "gpt-4o" 或 "openai:gpt-4o" |
| `ai.agent.modelHarness.models.<key>.maxIterations` | number \| string | no | — | — |
| `ai.agent.modelHarness.models.<key>.explorationBudget` | number \| string | no | — | 连续只读探索调用达到该次数时注入提示；0 关闭 |
| `ai.agent.modelHarness.models.<key>.explorationGuidance` | boolean \| string | no | — | 在系统提示中加入"先规划、限定目标文件"的探索纪律 |
| `ai.agent.modelHarness.models.<key>.iterationExtension` | number \| string | no | — | 每次有进展时延长的步数（覆盖 toolBudget.extendBy） |
| `ai.agent.modelHarness.models.<key>.maxTotalIterations` | number \| string | no | — | 单段回合的硬步数上限（覆盖 toolBudget.maxTotalIterations） |
| `ai.agent.modelHarness.models.<key>.emptyReplyRetries` | number \| string | no | — | 空回复（无文本且无工具调用）时额外重试次数；默认 0 |
| `ai.agent.modelHarness.models.<key>.requestTimeoutMs` | number \| string | no | — | 单次模型请求超时（毫秒）；0 关闭 |
| `ai.agent.modelHarness.providerPatterns` | object | no | — | provider 模式覆盖（支持 * 通配符） |
| `ai.agent.modelHarness.providerPatterns.<key>.maxIterations` | number \| string | no | — | — |
| `ai.agent.modelHarness.providerPatterns.<key>.explorationBudget` | number \| string | no | — | 连续只读探索调用达到该次数时注入提示；0 关闭 |
| `ai.agent.modelHarness.providerPatterns.<key>.explorationGuidance` | boolean \| string | no | — | 在系统提示中加入"先规划、限定目标文件"的探索纪律 |
| `ai.agent.modelHarness.providerPatterns.<key>.iterationExtension` | number \| string | no | — | 每次有进展时延长的步数（覆盖 toolBudget.extendBy） |
| `ai.agent.modelHarness.providerPatterns.<key>.maxTotalIterations` | number \| string | no | — | 单段回合的硬步数上限（覆盖 toolBudget.maxTotalIterations） |
| `ai.agent.modelHarness.providerPatterns.<key>.emptyReplyRetries` | number \| string | no | — | 空回复（无文本且无工具调用）时额外重试次数；默认 0 |
| `ai.agent.modelHarness.providerPatterns.<key>.requestTimeoutMs` | number \| string | no | — | 单次模型请求超时（毫秒）；0 关闭 |
| `ai.agent.providerResilience` | object | no | — | Provider 韧性：重试 / 退避 / 超时 / fallback（见 ProviderResilienceConfig，默认保守） |
| `ai.agent.providerResilience.maxRetries` | number \| string | no | — | Retries per model after the first attempt. Default 2. `0` disables retry. |
| `ai.agent.providerResilience.baseDelayMs` | number \| string | no | — | First backoff delay in ms; doubles each retry. Default 1000. |
| `ai.agent.providerResilience.maxDelayMs` | number \| string | no | — | Upper bound for one backoff delay in ms. Default 10000. |
| `ai.agent.providerResilience.maxRetryAfterMs` | number \| string | no | — | A `Retry-After` longer than this skips retry and goes to fallback. Default 30000. |
| `ai.agent.providerResilience.requestTimeoutMs` | number \| string | no | — | Per-attempt timeout in ms (whole streamed completion). Default 180000. `0` disables. |
| `ai.agent.providerResilience.emptyReplyRetries` | number \| string | no | — | Extra attempts when the model returns neither text nor tool calls (or a tool call without a name). Default 0: the reply is passed through unchanged. Quirk presets (see model harness) raise this for models known to emit spurious empty replies. |
| `ai.agent.providerResilience.fallback` | boolean \| string | no | — | Try the next entry of `modelCandidates` after retries are exhausted. Default true. |
| `ai.agent.deferredTools` | object | no | — | 工具 schema 按需加载 |
| `ai.agent.deferredTools.maxLoadedPerSession` | number \| string | no | — | — |
| `ai.agent.deferredTools.discoverTopK` | number \| string | no | — | — |
| `ai.agent.deferredTools.alwaysLoadedTools` | array&lt;string&gt; | no | — | 额外常驻工具；默认在内置常驻集合基础上追加 |
| `ai.agent.deferredTools.alwaysLoadedMode` | string | no | — | `extend`（默认）追加到内置常驻集合；`replace` 完全替换 |
| `ai.agent.deferredTools.mcpServers` | object | no | — | — |
| `ai.agent.deferredTools.mcpServers.<key>.alwaysLoaded` | array&lt;string&gt; | no | — | — |
| `ai.agent.workerBaseTools` | array&lt;string&gt; | no | — | Deferred Worker 基础工具 |
| `ai.agent.persona` | string | no | — | — |
| `ai.agent.maxIterations` | number \| string | no | — | — |
| `ai.agent.timeout` | number \| string | no | — | — |
| `ai.agent.preExecTimeout` | number \| string | no | — | — |
| `ai.agent.maxTools` | number \| string | no | — | — |
| `ai.agent.contextTailMessageLimit` | number \| string | no | — | — |
| `ai.agent.rateLimit` | object | no | — | — |
| `ai.agent.rateLimit.maxRequestsPerMinute` | number \| string | no | — | 每分钟最大请求数（默认 20） |
| `ai.agent.rateLimit.cooldownSeconds` | number \| string | no | — | 冷却时间（秒），超限后需等待（默认 10） |
| `ai.agent.toneAwareness` | boolean \| string | no | — | — |
| `ai.agent.contextTokens` | number \| string | no | — | — |
| `ai.agent.maxHistoryShare` | number \| string | no | — | — |
| `ai.agent.compaction` | object | no | — | — |
| `ai.agent.compaction.enabled` | boolean \| string | no | — | — |
| `ai.agent.compaction.auto` | boolean \| string | no | — | — |
| `ai.agent.compaction.keepRecentTokens` | number \| string | no | — | — |
| `ai.agent.compaction.minKeepCount` | number \| string | no | — | — |
| `ai.agent.compaction.thresholdRatio` | number \| string | no | — | Share of the model context window (system prompt and tools included) at which auto-compaction runs. Default 0.7 (#730). |
| `ai.agent.disabledTools` | array&lt;string&gt; | no | — | — |
| `ai.agent.allowedTools` | array&lt;string&gt; | no | — | — |
| `ai.agent.maxParallelSubagents` | number \| string | no | — | — |
| `ai.agent.subagentAutoContinue` | boolean \| string | no | — | — |
| `ai.agent.subagentDirectImDelivery` | boolean \| string | no | — | — |
| `ai.agent.maxSubagentIterations` | number \| string | no | — | — |
| `ai.agent.subagentTools` | array&lt;string&gt; | no | — | — |
| `ai.agent.subagentTurnWaitMs` | number \| string | no | — | — |
| `ai.agent.skillInstructionMaxChars` | number \| string | no | — | — |
| `ai.agent.promptTrace` | boolean \| string | no | — | — |
| `ai.agent.promptTraceVerbose` | boolean \| string | no | — | — |
| `ai.agent.promptCache` | boolean \| string | no | — | — |
| `ai.agent.promptCacheKeyPrefix` | string | no | — | — |
| `ai.agent.deferredAutoContinue` | boolean \| string | no | — | — |
| `ai.agent.deferredAutoContinueMaxDepth` | number \| string | no | — | — |
| `ai.agent.gitStatus` | boolean \| string | no | — | §1 Runtime 注入单行 git 状态摘要（非 git 仓库自动跳过） |
| `ai.agent.contextPaths` | array&lt;string&gt; | no | — | 追加的上下文文件路径（支持 ~ 与相对路径；默认另加载 ~/.config/zhin/AGENTS.md 等全局路径） |
| `ai.agent.systemPromptMaxChars` | number \| string | no | — | 系统提示词总字符上限；按 retention/order 让出预算，required 内容放不下则失败。 |
| `ai.agent.thinkingPreview` | boolean \| string | no | — | Activity feedback 展示 LLM 实际 thinking 内容（截断），而非静态 "思考中..."。 |
| `ai.agent.thinkingPreviewMaxLength` | number \| string | no | — | thinkingPreview 展示的最大字符数。 |
| `ai.enabled` | boolean \| string | no | — | — |
| `ai.providers` | object \| null | no | — | 命名 provider 实例 |
| `ai.providers.<key>.sdk` | string | no | — | — |
| `ai.providers.<key>.apiKey` | string | no | — | — |
| `ai.providers.<key>.authScheme` | string | no | — | Authorization 头方案。不写时用各 SDK 默认（OpenAI 系 `Bearer`，Anthropic `x-api-key`，Google `x-goog-api-key`）； 设为 `''` 时 `Authorization: &lt;key&gt;`；设为 `'Bearer'` / `'Token'` 等时 `Authorization: &lt;scheme&gt; &lt;key&gt;`（结尾空格可有可无）。 |
| `ai.providers.<key>.baseUrl` | string | no | — | — |
| `ai.providers.<key>.defaultModel` | string | no | — | — |
| `ai.providers.<key>.models` | array&lt;string&gt; | no | — | — |
| `ai.providers.<key>.timeout` | number \| string | no | — | 单次请求超时（ms），覆盖 `ai.providerResilience.requestTimeoutMs`；模型 harness 的 `requestTimeoutMs` 优先。0 关闭。 |
| `ai.providers.<key>.maxRetries` | number \| string | no | — | 每个模型的重试次数，覆盖 `ai.providerResilience.maxRetries`。 |
| `ai.providers.<key>.firstChunkTimeoutMs` | number \| string | no | — | 流式请求首个 chunk 超时（ms，含等待响应头），默认关闭；超时按 timeout 重试 / 切换备用模型。 |
| `ai.providers.<key>.chunkTimeoutMs` | number \| string | no | — | 流式请求两个 chunk 之间的静默超时（ms），默认关闭。 |
| `ai.providers.<key>.headers` | object | no | — | — |
| `ai.providers.<key>.contextWindow` | number \| string | no | — | 上下文窗口大小（token 数），各 Provider 映射到自身参数 |
| `ai.providers.<key>.maxOutputTokens` | number \| string | no | — | 每次请求的输出 token 上限，默认 8192；Gemini/Claude 的思考 token 也计入 |
| `ai.providers.<key>.thinkingLevel` | string | no | — | 思考深度：`off` \| `low` \| `medium` \| `high`；不填用 provider 默认；`providerOptions` 里的思考设置优先 |
| `ai.providers.<key>.capabilities` | object | no | — | Provider 能力声明 |
| `ai.providers.<key>.capabilities.input` | array&lt;string&gt; | no | — | Explicit model input modalities. Absence is text-only (fail closed), except Gemini chat models on `sdk: google` (see `defaultModelInput`). |
| `ai.providers.<key>.capabilities.streaming` | boolean \| string | no | — | — |
| `ai.providers.<key>.capabilities.toolCalling` | boolean \| string | no | — | — |
| `ai.providers.<key>.capabilities.thinking` | boolean \| string | no | — | — |
| `ai.providers.<key>.input` | array&lt;string&gt; | no | — | Explicit model input modalities. Prefer this over inferred provider identity. |
| `ai.providers.<key>.providerOptions` | object | no | — | Extra AI SDK `providerOptions`, merged into every request of this provider, keyed by SDK provider id. For Gemini: `{ google: { safetySettings: [...], thinkingConfig: { thinkingLevel: 'low' } } }`. See ai.google.dev safety settings. |
| `ai.providers.<key>.contextCache` | object | no | — | Gemini context caching (`sdk: google`): `{ mode: 'explicit', ttlSeconds }`. Default implicit. |
| `ai.providers.<key>.contextCache.mode` | string | no | — | `implicit` (default) leaves requests untouched. `explicit` creates cachedContents. |
| `ai.providers.<key>.contextCache.ttlSeconds` | number \| string | no | — | Lifetime of each created cache. Default 600. |
| `ai.providers.<key>.contextCache.minPrefixChars` | number \| string | no | — | Prefixes shorter than this (characters of JSON) are not worth a cache. Default 8000 (~2k tokens). |
| `ai.providers.<key>.imageGeneration` | object | no | — | 文生图默认（zhipu / cloudflare 等支持 generateImage 的 driver） |
| `ai.providers.<key>.imageGeneration.watermarkEnabled` | boolean \| string | no | — | 智谱 API `watermark_enabled`；默认 true |
| `ai.providers.<key>.imageGeneration.defaultModel` | string | no | — | — |
| `ai.providers.<key>.imageGeneration.defaultSize` | string | no | — | 智谱：如 1024x1024、1280x1280 |
| `ai.providers.<key>.imageGeneration.numSteps` | number \| string | no | — | Cloudflare Flux：推理步数，默认 4 |
| `ai.providers.<key>.imageGeneration.quality` | string | no | — | OpenAI GPT Image：low \| medium \| high \| auto |
| `ai.providers.<key>.imageGeneration.aspectRatio` | string | no | — | Gemini：如 1:1、16:9 |
| `ai.providers.<key>.imageGeneration.imageSize` | string | no | — | Gemini：如 1K、2K、4K |
| `ai.providers.<key>.imageGeneration.promptSuffix` | string | no | — | 追加到 agent/用户 prompt 末尾的风格约束（如写实摄影）。 需要动漫风时不要配置，或在工具 prompt 里写明即可。 |
| `ai.providers.<key>.host` | string | no | — | — |
| `ai.providers.<key>.num_ctx` | number \| string | no | — | — |
| `ai.agents` | object \| null | no | — | per-agent 绑定（协作角色如 researcher 亦用 agents.&lt;role&gt;）；IM 入站总是交给 zhin |
| `ai.agents.<key>.provider` | string | no | — | — |
| `ai.agents.<key>.model` | string | no | — | — |
| `ai.agents.<key>.mcpServers` | array \| null | no | — | — |
| `ai.agents.<key>.nickname` | string | no | — | Agent 昵称（LLM 自称 + IM 协作展示，ADR 0024）。 |
| `ai.sessions` | object \| null | no | — | — |
| `ai.sessions.maxHistory` | number \| string | no | — | 最大历史消息数（数据库模式默认200，内存模式默认100） |
| `ai.sessions.expireMs` | number \| string | no | — | 会话过期时间（毫秒，数据库模式默认7天，内存模式默认24小时） |
| `ai.sessions.useDatabase` | boolean \| string | no | — | 是否使用数据库持久化存储（默认 true） |
| `ai.sessions.coldStartMaxMessages` | number \| string | no | — | 无摘要时冷启动最多条数（默认 50） |
| `ai.sessions.coldStartMaxAgeMs` | number \| string | no | — | 冷启动时间窗（毫秒，默认 24h） |
| `ai.sessions.sessionIdleArchiveMs` | number \| string | no | — | 空闲后自动归档 active 会话（毫秒，默认 7 天；0=关闭） |
| `ai.context` | object \| null | no | — | — |
| `ai.context.enabled` | boolean \| string | no | — | 是否启用消息记录（默认 true） |
| `ai.context.maxRecentMessages` | number \| string | no | — | 读取的最近消息数量（默认 100） |
| `ai.context.summaryThreshold` | number \| string | no | — | 触发总结的消息数量阈值（默认 50） |
| `ai.context.keepAfterSummary` | number \| string | no | — | 总结后保留的消息数量（默认 10） |
| `ai.context.maxContextTokens` | number \| string | no | — | 上下文最大 token 估算（默认 4000） |
| `ai.context.summaryPrompt` | string | no | — | 自定义总结提示词 |
| `ai.imageGeneration` | object \| null | no | — | 文生图全局默认（可被 `providers.&lt;alias&gt;.imageGeneration` 覆盖）。 智谱：`watermarkEnabled: false` 需先在智谱开放平台签署去水印免责声明。 |
| `ai.imageGeneration.watermarkEnabled` | boolean \| string | no | — | 智谱 API `watermark_enabled`；默认 true |
| `ai.imageGeneration.defaultModel` | string | no | — | — |
| `ai.imageGeneration.defaultSize` | string | no | — | 智谱：如 1024x1024、1280x1280 |
| `ai.imageGeneration.numSteps` | number \| string | no | — | Cloudflare Flux：推理步数，默认 4 |
| `ai.imageGeneration.quality` | string | no | — | OpenAI GPT Image：low \| medium \| high \| auto |
| `ai.imageGeneration.aspectRatio` | string | no | — | Gemini：如 1:1、16:9 |
| `ai.imageGeneration.imageSize` | string | no | — | Gemini：如 1K、2K、4K |
| `ai.imageGeneration.promptSuffix` | string | no | — | 追加到 agent/用户 prompt 末尾的风格约束（如写实摄影）。 需要动漫风时不要配置，或在工具 prompt 里写明即可。 |
| `ai.multimodal` | object \| null | no | — | 入站/出站多模态（base64 契约；平台 adapter 负责编解码与发送） |
| `ai.multimodal.enabled` | boolean \| string | no | — | — |
| `ai.multimodal.maxFileBytes` | number \| string | no | — | — |
| `ai.multimodal.inboundDir` | string | no | — | — |
| `ai.multimodal.outboundDir` | string | no | — | — |
| `ai.multimodal.image` | object | no | — | — |
| `ai.multimodal.image.maxDimension` | number \| string | no | — | — |
| `ai.multimodal.image.preferNativeVision` | boolean \| string | no | — | — |
| `ai.multimodal.audio` | object | no | — | — |
| `ai.multimodal.audio.strategy` | string | no | — | — |
| `ai.multimodal.video` | object | no | — | — |
| `ai.multimodal.video.strategy` | string | no | — | — |
| `ai.multimodal.video.mcpServer` | string | no | — | — |
| `ai.multimodal.video.maxFrames` | number \| string | no | — | — |
| `ai.multimodal.outbound` | object | no | — | — |
| `ai.multimodal.outbound.splitMessages` | string | no | — | — |
| `ai.multimodal.perception` | object \| null | no | — | Perception pre-pass: when the turn's model cannot take an image / video / PDF, this media-capable model describes it and the description is injected as untrusted text (`[图片描述] …`). Unset = off (placeholders as before). |
| `ai.multimodal.perception.provider` | string | no | — | `ai.providers` alias of the perception model. |
| `ai.multimodal.perception.model` | string | no | — | — |
| `ai.multimodal.perception.kinds` | array&lt;string&gt; | no | — | Kinds to describe. Default `['image']`; `file` covers PDFs only. |
| `ai.multimodal.perception.maxChars` | number \| string | no | — | Description length cap in characters. Default 800. |
| `ai.multimodal.perception.timeoutMs` | number \| string | no | — | Per-attempt timeout in ms. Default 30000. |
| `ai.multimodal.perception.maxItemsPerTurn` | number \| string | no | — | Media described per turn; the rest keep the placeholder. Default 4. |
| `ai.multimodal.perception.fallbacks` | array&lt;object&gt; | no | — | 主识图模型失败、空回答或不支持该媒体时，按顺序尝试；不改变主对话模型。 |
| `ai.multimodal.perception.fallbacks[].provider` | string | yes | — | — |
| `ai.multimodal.perception.fallbacks[].model` | string | yes | — | — |
| `ai.memory` | object \| null | no | — | 三层 Markdown 文件记忆（global / platform / session）。 默认启用；设 enabled: false 可关闭注入。 |
| `ai.memory.enabled` | boolean \| string | no | — | — |
| `ai.memory.semantic` | object \| null | no | — | L4 语义记忆：memory_entries 表 + memory_search/upsert 工具 |
| `ai.memory.semantic.enabled` | boolean \| string | no | — | — |
| `ai.memory.semantic.autoConsolidate` | boolean \| string | no | — | — |
| `ai.memory.semantic.recall` | object \| null | no | — | Per-turn recall (#734): BM25 top-k entries relevant to the current message are added to the turn context. Default on when semantic memory is enabled; topK 5, maxTokens 400. |
| `ai.memory.semantic.recall.enabled` | boolean \| string | no | — | — |
| `ai.memory.semantic.recall.topK` | number \| string \| null | no | — | — |
| `ai.memory.semantic.recall.maxTokens` | number \| string \| null | no | — | — |
| `ai.memory.budgets` | object | no | — | — |
| `ai.memory.budgets.session` | number \| string | no | — | — |
| `ai.memory.budgets.platform` | number \| string | no | — | — |
| `ai.memory.budgets.global` | number \| string | no | — | — |
| `ai.memory.budgets.daily` | number \| string | no | — | — |
| `ai.knowledge` | object | no | — | 本地知识库（knowledge_search 工具数据源）。 放置 .md / .txt 文件到 baseDir，Agent 可通过 knowledge_search 工具检索。 |
| `ai.knowledge.baseDir` | string | no | — | 项目根目录内的知识库目录路径。配置该段时必须显式声明。 |
| `ai.githubMcp` | object | no | — | PAT for adapter-github auto-registered server-github MCP (overrides env when set). |
| `ai.githubMcp.token` | string | no | — | — |
| `ai.githubMcp.enabled` | boolean \| string | no | — | 为 true 时注册 server-github MCP（PAT，人身份）；默认 false，Bot 写操作用 adapter github_* 工具 |
| `ai.mcpServers` | array \| null | no | — | External MCP servers for the Agent MCP client (global, all bots). Listed servers are exposed to ZhinAgent tool pool when connected. |
| `ai.access` | object \| null | no | — | AI 访问控制（平台 AIGC 合规；Endpoint 可用 aiAccess 覆盖） |
| `ai.access.mode` | string | no | — | open \| closed \| whitelist，默认 open |
| `ai.access.users` | array&lt;string&gt; | no | — | 允许触发 AI 的 sender.id |
| `ai.access.groups` | array&lt;string&gt; | no | — | 允许触发 AI 的 group/channel id |
| `ai.access.denyMessage` | string | no | — | 私聊拒绝时的回复文案 |
| `ai.trigger` | object \| null | no | — | AI 触发配置 |
| `ai.trigger.enabled` | boolean \| string | no | — | 是否启用（默认 true） |
| `ai.trigger.prefixes` | array&lt;string&gt; | no | — | 触发前缀列表（默认 ['#', 'AI:']） |
| `ai.trigger.respondToAt` | boolean \| string | no | — | 是否响应 @ 机器人（默认 true） |
| `ai.trigger.respondToPrivate` | boolean \| string | no | — | 是否响应私聊（默认 true） |
| `ai.trigger.keywords` | array&lt;string&gt; | no | — | 触发关键词（可选） |
| `ai.trigger.ignorePrefixes` | array&lt;string&gt; | no | — | 忽略的前缀（命令前缀，避免与命令冲突，默认 ['/', '!', '！']） |
| `ai.trigger.timeout` | number \| string | no | — | 超时时间（毫秒，默认 60000） |
| `ai.trigger.thinkingMessage` | string | no | — | 思考中提示语（可选，设置后会在处理前发送） |
| `ai.trigger.errorTemplate` | string | no | — | 错误提示模板（默认 '❌ AI 处理失败: {error}'） |
| `ai.trigger.ambient` | object | no | — | 群聊旁听：群里没人叫机器人时，由判断模型决定是否接话。被 @、引用和私聊不经过这里，总会交给 Agent（Agent 也可以选择不回复）。 |
| `ai.trigger.ambient.conversations` | array&lt;string&gt; | no | — | 开启旁听的群，格式 platform:groupId；* 表示所有群。默认为空（关闭） |
| `ai.trigger.ambient.judge` | string \| array | no | — | 判断模型 providerAlias/model；也可以写成列表，前一个失败或限流时按顺序换下一个（免费额度通常按模型分别计算）。默认用主 Agent 的模型 |
| `ai.trigger.ambient.quietMs` | number \| string | no | — | 群安静多久后才判断一次（毫秒，默认 4000） |
| `ai.trigger.ambient.cooldownMs` | number \| string | no | — | 两次主动插话之间的最短间隔（毫秒，默认 120000）；对话进行中不受限制 |
| `ai.trigger.ambient.maxPerHour` | number \| string | no | — | 每个群每小时最多主动插话次数（默认 3）；对话进行中不计入 |
| `ai.trigger.ambient.conversationWindowMs` | number \| string | no | — | 机器人说话后，这段时间内算作对话进行中：群友接它的话只由判断模型决定，不受冷却和每小时次数限制（毫秒，默认 180000） |
| `ai.trigger.ambient.judgeIntervalMs` | number \| string | no | — | 没在对话时，同一个群至少隔这么久才判断一次（毫秒，默认 30000），节省判断模型的额度 |
| `ai.trigger.ambient.minConfidence` | number \| string | no | — | 判断模型置信度门槛 0..1（默认 0.7） |
| `ai.trigger.ambient.mode` | string: `"active"`, `"shadow"` | no | — | shadow 只记录判断结果、不回复（默认 active） |
| `menuKeyword` | string \| `false` | no | — | Built-in command menu keyword. Defaults to 菜单; false or an empty string disables the menu. |
| `menuStyle` | object | no | — | Command menu appearance when an HTML renderer is available; plain text fallback remains available. |
| `menuStyle.title` | string | no | — | Menu title. |
| `menuStyle.subtitle` | string | no | — | Menu subtitle. |
| `menuStyle.accentColor` | string | no | — | Six-digit hex accent color; invalid values use the renderer default. |
| `menuStyle.backgroundImage` | string | no | — | HTTP(S) image or PNG/JPEG/WebP data URL; unsupported values use the renderer default. |
| `mcp` | object | no | — | Expose Bot tools through an MCP Server. |
| `mcp.enabled` | boolean \| string | no | — | — |
| `mcp.path` | string \| null | no | — | — |
| `mcp.token` | string \| null | no | — | — |
| `mcp.allowUnauthenticatedLocalhost` | boolean \| string | no | — | — |
| `a2a` | object | no | — | A2A Agent Card, remote execution, and Workroom callbacks. |
| `a2a.enabled` | boolean \| string | no | — | — |
| `a2a.path` | string \| null | no | — | — |
| `a2a.token` | string \| null | no | — | — |
| `a2a.publicUrl` | string \| null | no | — | — |
| `a2a.workroomCallbacks` | object \| null | no | — | — |
| `a2a.workroomCallbacks.enabled` | boolean \| string | no | — | — |
| `a2a.workroomCallbacks.path` | string | no | — | Must remain outside the ordinary `/a2a/{agent}/*` route tree. |
| `a2a.workroomCallbacks.maxBodyBytes` | number \| string | no | — | — |
| `a2a.workroomCallbacks.maxSequenceGap` | number \| string | no | — | — |
| `a2a.workroomCallbacks.bindings` | array&lt;object&gt; | no | — | — |
| `a2a.workroomCallbacks.bindings[].endpointId` | string | no | — | — |
| `a2a.workroomCallbacks.bindings[].tenantId` | string | no | — | — |
| `a2a.workroomCallbacks.bindings[].cardDigest` | string | no | — | — |
| `a2a.workroomCallbacks.bindings[].authBindingId` | string | no | — | — |
| `a2a.workroomCallbacks.bindings[].trustDomain` | string | no | — | — |
| `a2a.workroomCallbacks.bindings[].extensionDigest` | string | no | — | — |
| `a2a.workroomCallbacks.bindings[].credentialId` | string | no | — | — |
| `a2a.workroomCallbacks.bindings[].credential` | object \| object | no | — | — |
| `a2a.workroomCallbacks.bindings[].enabled` | boolean \| string | no | — | — |
| `a2a.workroomCallbacks.bindings[].expiresAt` | number \| string | no | — | — |
| `a2a.workroomRemoteExecutors` | object \| null | no | — | Transport endpoints only. Project/Workroom topology remains in the persistent Catalog. |
| `a2a.workroomRemoteExecutors.enabled` | boolean \| string | no | — | — |
| `a2a.workroomRemoteExecutors.maxResponseBytes` | number \| string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings` | array&lt;object&gt; | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].endpointId` | string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].cardDigest` | string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authBindingId` | string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].dispatchUrl` | string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].pollUrl` | string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].credential` | object \| object | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority` | object | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.workroomExtension` | `"https://zhin.dev/extensions/workroom-executor/v1"` \| string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.idempotentDispatch` | boolean \| string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.typedCompletionEnvelope` | boolean \| string | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.workspaceProviders` | array&lt;string&gt; | no | — | — |
| `a2a.workroomRemoteExecutors.bindings[].enabled` | boolean \| string | no | — | — |
| `speech` | object | no | — | Speech-to-text and text-to-speech Host. |
| `speech.stt` | object \| null | no | — | — |
| `speech.stt.enabled` | boolean \| string | no | — | — |
| `speech.stt.provider` | string | no | — | — |
| `speech.stt.model` | string | no | — | — |
| `speech.stt.host` | string | no | — | — |
| `speech.stt.apiKey` | string | no | — | — |
| `speech.tts` | object \| null | no | — | — |
| `speech.tts.enabled` | boolean \| string | no | — | — |
| `speech.tts.provider` | string | no | — | — |
| `speech.tts.voice` | string | no | — | — |
| `speech.tts.model` | string | no | — | — |
| `speech.tts.host` | string | no | — | — |
| `speech.tts.apiKey` | string | no | — | — |
| `speech.tts.rate` | string | no | — | edge-tts |
| `speech.tts.pitch` | string | no | — | — |
| `speech.tts.edgeTtsCommand` | string | no | — | — |
| `speech.tts.region` | string | no | — | azure |
| `speech.tts.subscriptionKey` | string | no | — | — |
| `speech.tts.baseUrl` | string | no | — | custom OpenAI-compatible |
| `speech.tts.headers` | object | no | — | — |
| `speech.tts.speed` | number \| string | no | — | — |
| `htmlRenderer` | object | no | — | HTML and image rendering options backed by Shotium. |
| `htmlRenderer.width` | number | no | — | Default layout width in CSS pixels. |
| `htmlRenderer.defaultWidth` | number | no | — | Legacy alias of width. |
| `htmlRenderer.viewport` | object | no | — | Default viewport for Shotium rendering. |
| `htmlRenderer.viewport.width` | number | no | — | Viewport width in CSS pixels. |
| `htmlRenderer.viewport.height` | number | no | — | Viewport height in CSS pixels. |
| `htmlRenderer.backgroundColor` | string | no | — | Fragment background color. |
| `htmlRenderer.defaultBackgroundColor` | string | no | — | Legacy alias of backgroundColor. |
| `htmlRenderer.scale` | number | no | — | Device scale factor. |
| `htmlRenderer.type` | string: `"png"`, `"jpeg"`, `"webp"` | no | — | Default raster output format. |
| `htmlRenderer.quality` | number | no | — | Quality for jpeg/webp output. |
| `htmlRenderer.timeout` | number | no | — | Navigation timeout in milliseconds. |
| `htmlRenderer.waitUntil` | string: `"load"`, `"networkidle"` | no | — | Navigation wait strategy. |
| `htmlRenderer.fontFamily` | string | no | — | Default font-family for fragments. |
| `htmlRenderer.maxImageHeight` | number | no | — | Split overly tall PNGs above this height; 0 disables splitting. |
| `htmlRenderer.sliceCompression` | number | no | — | Compression level used when splitting PNGs. |
| `htmlRenderer.allowFileAccess` | boolean | no | — | Allow local file subresources. |
| `htmlRenderer.takeOverHtmlSegments` | boolean | no | — | Take over html/markdown rich-segment image rendering. |
| `htmlRenderer.cacheDir` | string | no | — | HTTP cache directory; use off to disable. |
| `htmlRenderer.cacheMaxBytes` | number | no | — | Maximum HTTP cache size in bytes. |
| `htmlRenderer.userAgent` | string | no | — | Custom user agent string. |
| `htmlRenderer.idleTimeoutMs` | number | no | — | Daemon idle-exit timeout in milliseconds. |
| `htmlRenderer.logStats` | boolean | no | — | Log render timing statistics. |
| `htmlRenderer.mode` | string: `"inprocess"`, `"daemon"` | no | — | Whether Shotium runs in-process or as a daemon. |
| `htmlRenderer.aiTextAsImage` | boolean \| object | no | — | Optional plain-text to image conversion before send. |
| `assistant` | object | no | — | Scheduled jobs, event ingress, and failure notifications. |
| `assistant.enabled` | boolean \| string | no | — | 启用统一 JobStore（默认 false，Stable 行为不变） |
| `assistant.queue` | object \| null | no | — | Schedule execution queue（重试 / 并发 / 死信） |
| `assistant.queue.maxConcurrency` | number \| string \| null | no | — | Schedule execution 并发上限 |
| `assistant.queue.maxRetries` | number \| string \| null | no | — | — |
| `assistant.queue.defaultTimeoutMs` | number \| string \| null | no | — | — |
| `assistant.defaults` | object \| null | no | — | — |
| `assistant.defaults.notify` | object \| object \| object \| object \| null | no | — | 未显式指定 notify 时的默认投递目标（M3） |
| `assistant.defaults.notifyOnFailure` | boolean \| string | no | — | Job 失败时是否通知（默认 false） |
| `assistant.profile` | object \| null | no | — | — |
| `assistant.profile.enabled` | boolean \| string | no | — | 启用 Profile 覆盖 Bootstrap（默认 false） |
| `assistant.profile.file` | string \| null | no | — | 相对项目根路径，默认 assistant.profile.yml |
| `assistant.home` | object \| null | no | — | — |
| `assistant.home.enabled` | boolean \| string | no | — | — |
| `assistant.home.restUrl` | string | no | — | HA REST 基址，如 http://homeassistant.local:8123 |
| `assistant.home.restToken` | string | no | — | HA 长期访问令牌 |
| `assistant.home.mcpServer` | string | no | — | 可选：ai.mcpServers 中的名称（REST 为主，MCP 仅校验） |
| `assistant.home.aliases` | object \| null | no | — | 中文/友好名 → entity_id |
| `assistant.home.policy` | object \| null | no | — | — |
| `assistant.home.policy.requireMaster` | boolean \| string | no | — | 仅 master 可调用 home_*（默认 true） |
| `assistant.home.policy.confirmServices` | array \| null | no | — | 写操作需 Owner 审批的 HA domain（默认 lock、alarm_control_panel） |
| `assistant.home.policy.allowedServiceDomains` | array \| null | no | — | home_call_service 允许的 domain 白名单（默认 light/climate/scene/cover/script） |
| `assistant.home.watch` | array \| null | no | — | 要通过 HA WebSocket 订阅状态变化的设备别名列表 |
| `assistant.home.debounceMs` | number \| string \| null | no | — | 同实体状态变化推送的防抖间隔（毫秒，默认 5000） |
| `assistant.events` | object \| null | no | — | — |
| `assistant.events.enabled` | boolean \| string | no | — | 启用 POST /api/assistant/events（需 assistant.enabled） |
| `assistant.events.token` | string | no | — | 可选专用 Bearer；未设时复用 http.token（路由仍在 /api 下受全局鉴权保护）。 |
| `assistant.events.allowedSources` | array&lt;string&gt; | no | — | 允许的来源白名单；空数组表示不限制 |
| `assistant.events.rateLimitPerMinute` | number \| string \| null | no | — | 每来源每分钟最大请求数（默认 60） |
| `log_level` | string \| number | no | — | Runtime log level. |
| `plugin` | object | no | — | Root Plugin configuration; replaced by its project schema during composition. |

## Plugin instance fields

These fields use the Runtime schema reader for trusted plugins’ `config: Schema.object(...)` declarations or `schema.json`; isolated plugins must use `schema.json`. Top-level `<name>` is the default instanceKey; `plugins.<name>` only stores the package reference.

### dingtalk

[`plugins/adapters/dingtalk/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/dingtalk/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `dingtalk.apiBaseUrl` | string | no | `"https://oapi.dingtalk.com"` | — |
| `dingtalk.master` | string \| number | no | — | 框架 master（DingTalk userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `dingtalk.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `dingtalk.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `dingtalk.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（DingTalk userid）；覆盖顶层 master |
| `dingtalk.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `dingtalk.endpoints[].appKey` | string | yes | — | Dingtalk app key |
| `dingtalk.endpoints[].appSecret` | string | yes | — | Dingtalk app secret |
| `dingtalk.endpoints[].webhookPath` | string | no | — | Dingtalk webhook path |
| `dingtalk.endpoints[].robotCode` | string | no | — | Dingtalk robot code |
| `dingtalk.endpoints[].apiBaseUrl` | string | no | — | — |
| `dingtalk.endpoints[].commandPrefix` | string | no | — | — |
| `dingtalk.endpoints[].id` | string | yes | — | Dingtalk bot name |
| `dingtalk.endpoints[].mode` | string: `"webhook"`, `"stream"` | no | `"webhook"` | — |
| `dingtalk.endpoints[].cardTemplateId` | string | no | — | Stream interactive card template ID |
| `dingtalk.endpoints[].cardButtonCount` | integer | no | `2` | Fixed button count in the card template |
| `dingtalk.endpoints[].streamProxy` | object | no | — | 故障验收专用：TCP固定127.0.0.1，保留真实WSS TLS身份 |
| `dingtalk.endpoints[].streamProxy.port` | integer | yes | — | — |
| `dingtalk.endpoints[].streamProxy.serverName` | string | yes | — | — |
| `dingtalk.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `dingtalk.mode` | string: `"webhook"`, `"stream"` | no | `"webhook"` | — |
| `dingtalk.cardTemplateId` | string | no | — | Stream interactive card template ID |
| `dingtalk.cardButtonCount` | integer | no | `2` | Fixed button count in the card template |

### discord

[`plugins/adapters/discord/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/discord/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `discord.connection` | string: `"gateway"`, `"interactions"` | no | `"gateway"` | Gateway WebSocket (default). interactions uses httpHostToken POST + Ed25519 verify. |
| `discord.intents` | array&lt;number&gt; | no | — | — |
| `discord.enableSlashCommands` | boolean | no | `false` | — |
| `discord.globalCommands` | boolean | no | `false` | — |
| `discord.defaultActivity` | object | no | — | — |
| `discord.defaultActivity.name` | string | yes | — | — |
| `discord.defaultActivity.type` | string: `"PLAYING"`, `"STREAMING"`, `"LISTENING"`, `"WATCHING"`, `"COMPETING"` | yes | — | — |
| `discord.defaultActivity.url` | string | no | — | — |
| `discord.slashCommands` | array&lt;object&gt; | no | — | — |
| `discord.applicationId` | string | no | — | Required when connection is interactions. |
| `discord.publicKey` | string | no | — | Required when connection is interactions (hex Ed25519 public key). |
| `discord.interactionsPath` | string | no | `"/discord/interactions"` | POST path on httpHostToken when connection is interactions. |
| `discord.master` | string \| number | no | — | 框架 master（Discord user snowflake；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `discord.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `discord.endpoints` | array&lt;object&gt; | yes | — | 多账号：每项定义一个 endpoint，id/token 必填，其余字段覆盖实例默认值 |
| `discord.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Discord user snowflake）；覆盖顶层 master |
| `discord.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `discord.endpoints[].token` | string | yes | — | Discord bot token |
| `discord.endpoints[].connection` | string: `"gateway"`, `"interactions"` | no | — | — |
| `discord.endpoints[].intents` | array&lt;number&gt; | no | — | — |
| `discord.endpoints[].enableSlashCommands` | boolean | no | — | — |
| `discord.endpoints[].globalCommands` | boolean | no | — | — |
| `discord.endpoints[].defaultActivity` | object | no | — | — |
| `discord.endpoints[].defaultActivity.name` | string | yes | — | — |
| `discord.endpoints[].defaultActivity.type` | string: `"PLAYING"`, `"STREAMING"`, `"LISTENING"`, `"WATCHING"`, `"COMPETING"` | yes | — | — |
| `discord.endpoints[].defaultActivity.url` | string | no | — | — |
| `discord.endpoints[].slashCommands` | array&lt;object&gt; | no | — | — |
| `discord.endpoints[].applicationId` | string | no | — | — |
| `discord.endpoints[].publicKey` | string | no | — | — |
| `discord.endpoints[].interactionsPath` | string | no | — | — |
| `discord.endpoints[].commandPrefix` | string | no | — | — |
| `discord.endpoints[].id` | string | yes | — | Discord bot name |
| `discord.endpoints[].gatewayFaultProxyUrl` | string | no | — | Isolated acceptance only: loopback Gateway fault proxy; REST unchanged. |
| `discord.endpoints[].restApiProxy` | object | no | — | Gateway测试实例REST专用故障代理：discord.com:443固定loopback TCP，保留SNI/证书校验，独立于Gateway代理 |
| `discord.endpoints[].restApiProxy.port` | integer | yes | — | — |
| `discord.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `discord.gatewayFaultProxyUrl` | string | no | — | Isolated acceptance only: loopback Gateway fault proxy; REST unchanged. |

### email

[`plugins/adapters/email/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/email/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `email.master` | string \| number | no | — | 框架 master（email address；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `email.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `email.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `email.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（email address）；覆盖顶层 master |
| `email.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `email.endpoints[].smtp` | object | yes | — | — |
| `email.endpoints[].smtp.host` | string | yes | — | — |
| `email.endpoints[].smtp.port` | number | yes | — | — |
| `email.endpoints[].smtp.secure` | boolean | yes | — | — |
| `email.endpoints[].smtp.auth` | object | yes | — | — |
| `email.endpoints[].smtp.auth.user` | string | yes | — | — |
| `email.endpoints[].smtp.auth.pass` | string | yes | — | — |
| `email.endpoints[].smtp.serverName` | string | no | — | TLS SNI 与证书主机名校验，代理场景保留原服务域名；不改变证书校验策略 |
| `email.endpoints[].imap` | object | yes | — | — |
| `email.endpoints[].imap.host` | string | yes | — | — |
| `email.endpoints[].imap.port` | number | yes | — | — |
| `email.endpoints[].imap.tls` | boolean | yes | — | — |
| `email.endpoints[].imap.user` | string | yes | — | — |
| `email.endpoints[].imap.password` | string | yes | — | — |
| `email.endpoints[].imap.checkInterval` | number | no | `60000` | — |
| `email.endpoints[].imap.reconnectInterval` | number | no | `5000` | — |
| `email.endpoints[].imap.mailbox` | string | no | `"INBOX"` | — |
| `email.endpoints[].imap.markSeen` | boolean | no | `true` | — |
| `email.endpoints[].imap.serverName` | string | no | — | TLS SNI 与证书主机名校验，代理场景保留原服务域名；不改变证书校验策略 |
| `email.endpoints[].attachments` | object | no | — | — |
| `email.endpoints[].attachments.enabled` | boolean | no | `false` | — |
| `email.endpoints[].attachments.downloadPath` | string | no | — | — |
| `email.endpoints[].attachments.maxFileSize` | number | no | — | — |
| `email.endpoints[].attachments.allowedTypes` | array&lt;string&gt; | no | — | — |
| `email.endpoints[].commandPrefix` | string | no | — | — |
| `email.endpoints[].id` | string | yes | — | Email bot name |
| `email.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### github

[`plugins/adapters/github/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/github/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `github.host` | string | no | — | GitHub Enterprise hostname (default github.com) |
| `github.webhook_path` | string | no | `"/github/webhook"` | — |
| `github.auto_reply_repos` | array&lt;string&gt; | no | — | Repos whose Issue/PR comments auto-trigger AI without @bot |
| `github.bot_login` | string | no | — | Override App bot login (default {slug}[bot]) |
| `github.workspace_root` | string | no | — | Managed git workspace root |
| `github.master` | string \| number | no | — | 框架 master（GitHub user login or id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `github.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `github.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint |
| `github.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（GitHub user login or id）；覆盖顶层 master |
| `github.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `github.endpoints[].app_id` | string \| number | yes | — | GitHub App ID |
| `github.endpoints[].private_key` | string | yes | — | GitHub App private key (PEM content or file path) |
| `github.endpoints[].webhook_secret` | string | no | — | Webhook HMAC secret; enables httpHostToken POST route |
| `github.endpoints[].id` | string | yes | — | GitHub App bot name |
| `github.endpoints[].host` | string | no | — | GitHub Enterprise hostname |
| `github.endpoints[].webhook_path` | string | no | — | Webhook route path |
| `github.endpoints[].auto_reply_repos` | array&lt;string&gt; | no | — | Repos whose comments auto-trigger AI |
| `github.endpoints[].bot_login` | string | no | — | Override App bot login |
| `github.endpoints[].workspace_root` | string | no | — | Managed git workspace root |
| `github.endpoints[].commandPrefix` | string | no | — | 本 endpoint 的命令前缀 |
| `github.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### icqq

[`plugins/adapters/icqq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/icqq/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `icqq.master` | string \| number | yes | — | 框架 master QQ uin（/approve、AI/工具权限）；endpoints[i].master 可逐项覆盖 |
| `icqq.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted QQ uin 列表（弱于 master） |
| `icqq.password` | string | no | — | QQ 密码（可选，不填则扫码登录） |
| `icqq.platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | no | `1` | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `icqq.ver` | string | no | — | 协议版本号，仅在对应 platform 有多个版本时有效，不填则使用最新版本 |
| `icqq.signApiAddr` | string | no | — | 签名服务器地址；未配置时若安装了 @icqqjs/qqsign 则自动使用本地签名 |
| `icqq.dataDir` | string | no | — | 数据存储文件夹路径，默认为主模块下的 data 文件夹 |
| `icqq.autoReconnect` | boolean | no | `true` | 断线后是否自动重连（默认 true） |
| `icqq.outboundMedia` | string: `"file"`, `"base64"` | no | `"file"` | 出站媒体模式：file=落盘本地路径（默认）; base64=CQ base64:// 内联 |
| `icqq.ignoreSelf` | boolean | no | `true` | 群聊和频道中是否过滤自己的消息（默认 true） |
| `icqq.resend` | boolean | no | `false` | 被风控时是否尝试用分片发送（默认 false） |
| `icqq.cacheGroupMember` | boolean | no | `true` | 是否缓存群员列表（默认 true）；群多时（500+）会多占约 100MB+ 内存 |
| `icqq.autoServer` | boolean | no | `true` | 是否自动选择最优服务器（默认 true） |
| `icqq.qqnt` | boolean | no | `true` | 是否使用 QQNT 协议（默认 true） |
| `icqq.ntLogin` | boolean | no | — | 是否使用 NT 登录方式 |
| `icqq.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `icqq.endpoints[].id` | string | yes | — | QQ uin |
| `icqq.endpoints[].master` | string \| number | no | — | 本 endpoint 的 master QQ uin；覆盖顶层 master |
| `icqq.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `icqq.endpoints[].password` | string | no | — | 本 endpoint 的 QQ 密码 |
| `icqq.endpoints[].platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | no | — | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `icqq.endpoints[].ver` | string | no | — | 协议版本号 |
| `icqq.endpoints[].signApiAddr` | string | no | — | 签名服务器地址 |
| `icqq.endpoints[].dataDir` | string | no | — | 数据存储文件夹路径 |
| `icqq.endpoints[].autoReconnect` | boolean | no | — | 断线后是否自动重连 |
| `icqq.endpoints[].outboundMedia` | string: `"file"`, `"base64"` | no | — | 出站媒体模式 |
| `icqq.endpoints[].ignoreSelf` | boolean | no | — | 是否过滤自己的消息 |
| `icqq.endpoints[].resend` | boolean | no | — | 被风控时是否分片发送 |
| `icqq.endpoints[].cacheGroupMember` | boolean | no | — | 是否缓存群员列表 |
| `icqq.endpoints[].autoServer` | boolean | no | — | 是否自动选择最优服务器 |
| `icqq.endpoints[].qqnt` | boolean | no | — | 是否使用 QQNT 协议 |
| `icqq.endpoints[].ntLogin` | boolean | no | — | 是否使用 NT 登录方式 |
| `icqq.endpoints[].commandPrefix` | string | no | — | 本 endpoint 的命令前缀 |
| `icqq.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀）。endpoints[i] 可逐项覆盖 |

### kook

[`plugins/adapters/kook/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/kook/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `kook.connection` | string: `"websocket"`, `"webhook"` | no | `"websocket"` | WebSocket gateway (default). webhook requires httpHostToken, verify_token, and a public HTTPS callback URL. |
| `kook.webhookPath` | string | no | `"/kook/webhook"` | POST path registered via httpHostToken when connection is webhook. |
| `kook.data_dir` | string | no | — | — |
| `kook.timeout` | number | no | `10000` | — |
| `kook.max_retry` | number | no | `3` | — |
| `kook.ignore` | string: `"bot"`, `"self"` | no | `"bot"` | — |
| `kook.logLevel` | string: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`, `"mark"`, `"off"` | no | `"info"` | — |
| `kook.master` | string \| number | no | — | 框架 master（KOOK user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `kook.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `kook.endpoints` | array&lt;object&gt; | yes | — | 多账号：每项定义一个 endpoint，id/token 必填，其余字段覆盖实例默认值 |
| `kook.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（KOOK user id）；覆盖顶层 master |
| `kook.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `kook.endpoints[].token` | string | yes | — | KOOK bot token |
| `kook.endpoints[].connection` | string: `"websocket"`, `"webhook"` | no | — | — |
| `kook.endpoints[].webhookPath` | string | no | — | — |
| `kook.endpoints[].verify_token` | string | no | — | KOOK developer console verify token (required for webhook mode). |
| `kook.endpoints[].encrypt_key` | string | no | — | Optional Encrypt Key when message encryption is enabled in KOOK console. |
| `kook.endpoints[].data_dir` | string | no | — | — |
| `kook.endpoints[].timeout` | number | no | — | — |
| `kook.endpoints[].max_retry` | number | no | — | — |
| `kook.endpoints[].ignore` | string: `"bot"`, `"self"` | no | — | — |
| `kook.endpoints[].logLevel` | string: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`, `"mark"`, `"off"` | no | — | — |
| `kook.endpoints[].commandPrefix` | string | no | — | — |
| `kook.endpoints[].id` | string | yes | — | KOOK bot name |
| `kook.endpoints[].streamProxy` | object | no | — | WSS故障验收固定loopback，保持真实TLS身份 |
| `kook.endpoints[].streamProxy.port` | integer | yes | — | — |
| `kook.endpoints[].streamProxy.serverName` | string | yes | — | — |
| `kook.endpoints[].apiProxy` | object | no | — | Optional fixed loopback TCP route for www.kookapp.cn JSON API only; verified TLS remains enabled. |
| `kook.endpoints[].apiProxy.port` | integer | yes | — | — |
| `kook.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### lark

[`plugins/adapters/lark/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/lark/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `lark.webhookPath` | string | no | `"/lark/webhook"` | — |
| `lark.apiBaseUrl` | string | no | — | — |
| `lark.isFeishu` | boolean | no | `true` | — |
| `lark.master` | string \| number | no | — | 框架 master（Lark/Feishu open_id or user_id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `lark.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `lark.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `lark.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Lark/Feishu open_id or user_id）；覆盖顶层 master |
| `lark.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `lark.endpoints[].appId` | string | yes | — | Lark app ID |
| `lark.endpoints[].appSecret` | string | yes | — | Lark app secret |
| `lark.endpoints[].encryptKey` | string | no | — | Lark encrypt key |
| `lark.endpoints[].verificationToken` | string | no | — | Lark verification token |
| `lark.endpoints[].webhookPath` | string | no | — | — |
| `lark.endpoints[].apiBaseUrl` | string | no | — | — |
| `lark.endpoints[].isFeishu` | boolean | no | — | — |
| `lark.endpoints[].commandPrefix` | string | no | — | — |
| `lark.endpoints[].id` | string | yes | — | Lark bot name |
| `lark.endpoints[].mode` | string: `"webhook"`, `"websocket"` | no | `"webhook"` | — |
| `lark.endpoints[].streamProxy` | object | no | — | WSS故障验收：仅TCP固定loopback，保留TLS身份 |
| `lark.endpoints[].streamProxy.port` | integer | yes | — | — |
| `lark.endpoints[].streamProxy.serverName` | string | yes | — | — |
| `lark.endpoints[].webApiProxy` | object | no | — | 默认关闭；仅飞书出站API的loopback TLS故障代理，保留官方Host/SNI和证书校验，与streamProxy独立 |
| `lark.endpoints[].webApiProxy.port` | integer | yes | — | — |
| `lark.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `lark.mode` | string: `"webhook"`, `"websocket"` | no | `"webhook"` | — |
| `lark.webApiProxy` | object | no | — | 默认关闭；仅飞书出站API的loopback TLS故障代理，保留官方Host/SNI和证书校验，与streamProxy独立 |
| `lark.webApiProxy.port` | integer | yes | — | — |

### line

[`plugins/adapters/line/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/line/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `line.webhookPath` | string | no | `"/line/webhook"` | — |
| `line.apiBaseUrl` | string | no | `"https://api.line.me"` | — |
| `line.master` | string \| number | no | — | 框架 master（LINE user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `line.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `line.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `line.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（LINE user id）；覆盖顶层 master |
| `line.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `line.endpoints[].channelSecret` | string | yes | — | LINE channel secret |
| `line.endpoints[].channelAccessToken` | string | yes | — | LINE channel access token |
| `line.endpoints[].webhookPath` | string | no | — | — |
| `line.endpoints[].apiBaseUrl` | string | no | — | — |
| `line.endpoints[].commandPrefix` | string | no | — | — |
| `line.endpoints[].id` | string | yes | — | LINE bot name |
| `line.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### milky

[`plugins/adapters/milky/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/milky/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `milky.connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | no | `"ws"` | ws (default), sse (EventSource client), webhook or wss (webhook/wss via httpHostToken) |
| `milky.reconnect_interval` | number | no | `5000` | — |
| `milky.heartbeat_interval` | number | no | `30000` | — |
| `milky.master` | string \| number | no | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `milky.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `milky.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `milky.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `milky.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `milky.endpoints[].connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | no | — | — |
| `milky.endpoints[].baseUrl` | string | yes | — | Milky HTTP API base URL (required); WS event path is derived as ws(s)://host/event |
| `milky.endpoints[].path` | string | no | — | Path for webhook / reverse-wss |
| `milky.endpoints[].access_token` | string | no | — | Milky access token |
| `milky.endpoints[].reconnect_interval` | number | no | — | — |
| `milky.endpoints[].heartbeat_interval` | number | no | — | — |
| `milky.endpoints[].commandPrefix` | string | no | — | — |
| `milky.endpoints[].id` | string | yes | — | Milky bot name |
| `milky.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### napcat

[`plugins/adapters/napcat/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/napcat/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `napcat.connection` | string: `"ws"`, `"wss"`, `"http"` | no | `"ws"` | ws (default), wss (reverse WS), or http (POST webhook + HTTP API outbound) |
| `napcat.reconnect_interval` | number | no | `5000` | — |
| `napcat.heartbeat_interval` | number | no | `30000` | — |
| `napcat.poll_interval` | number | no | `30000` | — |
| `napcat.master` | string \| number | no | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `napcat.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `napcat.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `napcat.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `napcat.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `napcat.endpoints[].connection` | string: `"ws"`, `"wss"`, `"http"` | no | — | — |
| `napcat.endpoints[].url` | string | no | — | NapCat WebSocket URL (required for connection: ws) |
| `napcat.endpoints[].path` | string | no | — | WS path for reverse-wss |
| `napcat.endpoints[].http_url` | string | no | — | HTTP API base URL (connection: http outbound) |
| `napcat.endpoints[].post_path` | string | no | — | HTTP POST event path (connection: http inbound) |
| `napcat.endpoints[].access_token` | string | no | — | NapCat access token |
| `napcat.endpoints[].reconnect_interval` | number | no | — | — |
| `napcat.endpoints[].heartbeat_interval` | number | no | — | — |
| `napcat.endpoints[].poll_interval` | number | no | — | — |
| `napcat.endpoints[].commandPrefix` | string | no | — | — |
| `napcat.endpoints[].id` | string | yes | — | NapCat bot name |
| `napcat.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot11

[`plugins/adapters/onebot11/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot11/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `onebot11.connection` | string: `"ws"`, `"wss"` | no | `"ws"` | connection: ws (forward WS client, default) or wss (reverse WS via httpHostToken) |
| `onebot11.reconnect_interval` | number | no | `5000` | — |
| `onebot11.heartbeat_interval` | number | no | `30000` | — |
| `onebot11.master` | string \| number | no | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `onebot11.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `onebot11.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `onebot11.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `onebot11.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `onebot11.endpoints[].connection` | string: `"ws"`, `"wss"` | no | — | — |
| `onebot11.endpoints[].url` | string | no | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `onebot11.endpoints[].path` | string | no | — | WS path for reverse-wss (connection: wss) |
| `onebot11.endpoints[].access_token` | string | no | — | OneBot access token |
| `onebot11.endpoints[].reconnect_interval` | number | no | — | — |
| `onebot11.endpoints[].heartbeat_interval` | number | no | — | — |
| `onebot11.endpoints[].commandPrefix` | string | no | — | — |
| `onebot11.endpoints[].id` | string | yes | — | OneBot11 bot name |
| `onebot11.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot12

[`plugins/adapters/onebot12/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot12/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `onebot12.connection` | string: `"ws"`, `"webhook"`, `"wss"` | no | `"ws"` | ws (default), webhook (httpHostToken POST), or wss (reverse WS via httpHostToken) |
| `onebot12.reconnect_interval` | number | no | `5000` | — |
| `onebot12.heartbeat_interval` | number | no | `30000` | — |
| `onebot12.master` | string \| number | no | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `onebot12.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `onebot12.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `onebot12.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `onebot12.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `onebot12.endpoints[].connection` | string: `"ws"`, `"webhook"`, `"wss"` | no | — | — |
| `onebot12.endpoints[].url` | string | no | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `onebot12.endpoints[].path` | string | no | — | HTTP/WS path for webhook or reverse-wss |
| `onebot12.endpoints[].api_url` | string | no | — | HTTP action endpoint for webhook outbound (required for connection: webhook send) |
| `onebot12.endpoints[].access_token` | string | no | — | OneBot access token |
| `onebot12.endpoints[].reconnect_interval` | number | no | — | — |
| `onebot12.endpoints[].heartbeat_interval` | number | no | — | — |
| `onebot12.endpoints[].commandPrefix` | string | no | — | — |
| `onebot12.endpoints[].id` | string | yes | — | OneBot12 bot name |
| `onebot12.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### qq

[`plugins/adapters/qq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/qq/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `qq.mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | no | `"websocket"` | WebSocket gateway (default). webhook/middleware use httpHostToken POST. |
| `qq.sandbox` | boolean | no | `false` | — |
| `qq.botKind` | string: `"public"`, `"private"` | no | `"public"` | 公域/私域：均含 GROUP_AND_C2C_EVENT；频道消息分别为 PUBLIC_GUILD_MESSAGES / GUILD_MESSAGES。未显式配置 intents 时按此展开 |
| `qq.master` | string \| number | no | — | 框架 master（endpoint 管理命令、AI/工具权限）；openid。endpoints[i].master 可逐项覆盖 |
| `qq.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `qq.intents` | array&lt;string&gt; | no | — | WebSocket Identify intents；省略时按 botKind 自动生成（public→含 PUBLIC_GUILD_MESSAGES） |
| `qq.accessTokenUrl` | string | no | — | — |
| `qq.gatewayUrl` | string | no | — | — |
| `qq.webhookPath` | string | no | `"/qq/webhook"` | POST path on httpHostToken for webhook/middleware modes. |
| `qq.endpoints` | array&lt;object&gt; | yes | — | 多账号：每项定义一个 endpoint，id/appid/secret 必填，其余字段覆盖实例默认值 |
| `qq.endpoints[].appid` | string | yes | — | QQ official bot app ID |
| `qq.endpoints[].secret` | string | yes | — | QQ official bot secret |
| `qq.endpoints[].mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | no | — | — |
| `qq.endpoints[].sandbox` | boolean | no | — | — |
| `qq.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（openid）；覆盖顶层 master |
| `qq.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `qq.endpoints[].botKind` | string: `"public"`, `"private"` | no | — | 覆盖顶层 botKind（公域/私域），用于按 endpoint 生成 intents |
| `qq.endpoints[].intents` | array&lt;string&gt; | no | — | 覆盖顶层 intents |
| `qq.endpoints[].accessTokenUrl` | string | no | — | — |
| `qq.endpoints[].gatewayUrl` | string | no | — | — |
| `qq.endpoints[].webhookPath` | string | no | — | — |
| `qq.endpoints[].commandPrefix` | string | no | — | — |
| `qq.endpoints[].id` | string | yes | — | QQ bot name |
| `qq.endpoints[].streamProxy` | object | no | — | Optional fixed loopback TCP fault proxy for WSS only; original gateway TLS identity must match serverName. |
| `qq.endpoints[].streamProxy.port` | integer | yes | — | — |
| `qq.endpoints[].streamProxy.serverName` | string | yes | — | — |
| `qq.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `qq.streamProxy` | object | no | — | Optional fixed loopback TCP fault proxy for WSS only; original gateway TLS identity must match serverName. |
| `qq.streamProxy.port` | integer | yes | — | — |
| `qq.streamProxy.serverName` | string | yes | — | — |

### sandbox

[`plugins/adapters/sandbox/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/sandbox/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `sandbox.master` | string \| number | no | — | 框架 master（sandbox client id (distinct from endpoints[].owner)；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `sandbox.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `sandbox.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `sandbox.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（sandbox client id (distinct from endpoints[].owner)）；覆盖顶层 master |
| `sandbox.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `sandbox.endpoints[].owner` | string | no | — | Sandbox owner user ID |
| `sandbox.endpoints[].commandPrefix` | string | no | — | — |
| `sandbox.endpoints[].id` | string | yes | — | Sandbox bot name |
| `sandbox.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### satori

[`plugins/adapters/satori/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/satori/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `satori.connection` | string: `"ws"`, `"webhook"` | no | `"ws"` | ws (default) or webhook (httpHostToken POST route) |
| `satori.heartbeat_interval` | number | no | `10000` | WS PING interval in milliseconds |
| `satori.master` | string \| number | no | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `satori.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `satori.endpoints` | array&lt;object&gt; | yes | — | 多账号：每项定义一个 endpoint，id/baseUrl 必填，其余字段覆盖实例默认值 |
| `satori.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `satori.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `satori.endpoints[].baseUrl` | string | yes | — | Satori SDK HTTP/WS base URL (e.g. http://127.0.0.1:5140) |
| `satori.endpoints[].connection` | string: `"ws"`, `"webhook"` | no | — | — |
| `satori.endpoints[].token` | string | no | — | Bearer token for API and WS IDENTIFY |
| `satori.endpoints[].path` | string | no | — | Webhook POST path (connection: webhook) |
| `satori.endpoints[].heartbeat_interval` | number | no | — | — |
| `satori.endpoints[].commandPrefix` | string | no | — | — |
| `satori.endpoints[].id` | string | yes | — | Satori bot name |
| `satori.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### slack

[`plugins/adapters/slack/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/slack/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `slack.socketMode` | boolean | no | `true` | Prefer Socket Mode (default). Set false for HTTP Events via httpHostToken. |
| `slack.webhookPath` | string | no | `"/slack/events"` | — |
| `slack.clientPingTimeout` | number | no | `15000` | Socket Mode client ping timeout (ms) |
| `slack.master` | string \| number | no | — | 框架 master（Slack user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `slack.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `slack.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `slack.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Slack user id）；覆盖顶层 master |
| `slack.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `slack.endpoints[].token` | string | yes | — | Bot User OAuth Token (xoxb-...) |
| `slack.endpoints[].signingSecret` | string | no | — | Required for HTTP Events API (socketMode: false) |
| `slack.endpoints[].appToken` | string | no | — | App-Level Token (xapp-...) for Socket Mode |
| `slack.endpoints[].socketMode` | boolean | no | — | — |
| `slack.endpoints[].webhookPath` | string | no | — | — |
| `slack.endpoints[].clientPingTimeout` | number | no | — | — |
| `slack.endpoints[].commandPrefix` | string | no | — | — |
| `slack.endpoints[].id` | string | yes | — | Slack bot name |
| `slack.endpoints[].streamProxy` | object | no | — | Socket故障验收：WSS固定loopback TCP，API仍标准TLS直连 |
| `slack.endpoints[].streamProxy.port` | integer | yes | — | — |
| `slack.endpoints[].streamProxy.serverName` | string | yes | — | — |
| `slack.endpoints[].webApiProxy` | object | no | — | 出站JSON Web API专用故障代理：仅slack.com:443，固定loopbackTCP，保留SNI和证书校验，与Socket代理独立；上传域名不适用 |
| `slack.endpoints[].webApiProxy.port` | integer | yes | — | — |
| `slack.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### telegram

[`plugins/adapters/telegram/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/telegram/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `telegram.polling` | boolean | no | `true` | Long-poll getUpdates (default). Set false for webhook via httpHostToken. |
| `telegram.webhook` | object | no | — | Webhook settings when polling is false. |
| `telegram.webhook.domain` | string | no | — | — |
| `telegram.webhook.path` | string | no | `"/telegram/webhook"` | — |
| `telegram.webhook.secretToken` | string | no | — | Verified via X-Telegram-Bot-Api-Secret-Token. |
| `telegram.allowedUpdates` | array&lt;string&gt; | no | `["message","callback_query"]` | — |
| `telegram.apiBaseUrl` | string | no | `"https://api.telegram.org"` | — |
| `telegram.master` | string \| number | no | — | 框架 master（Telegram user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `telegram.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `telegram.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `telegram.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Telegram user id）；覆盖顶层 master |
| `telegram.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `telegram.endpoints[].token` | string | yes | — | Telegram bot token |
| `telegram.endpoints[].polling` | boolean | no | — | — |
| `telegram.endpoints[].webhook` | object | no | — | — |
| `telegram.endpoints[].webhook.domain` | string | no | — | — |
| `telegram.endpoints[].webhook.path` | string | no | — | — |
| `telegram.endpoints[].webhook.secretToken` | string | no | — | — |
| `telegram.endpoints[].allowedUpdates` | array&lt;string&gt; | no | — | — |
| `telegram.endpoints[].apiBaseUrl` | string | no | — | — |
| `telegram.endpoints[].commandPrefix` | string | no | — | — |
| `telegram.endpoints[].id` | string | yes | — | Telegram bot name |
| `telegram.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wechat-mp

[`plugins/adapters/wechat-mp/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wechat-mp/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `wechat-mp.path` | string | no | `"/wechat/webhook"` | — |
| `wechat-mp.encrypt` | boolean | no | `false` | — |
| `wechat-mp.encryptMode` | string: `"plain"`, `"compatible"`, `"secure"` | no | — | Default follows encrypt: 'plain' when encrypt=false, 'compatible' when encrypt=true |
| `wechat-mp.replyMode` | string: `"passive"`, `"customer_service"` | no | `"passive"` | — |
| `wechat-mp.passiveReplyTimeoutMs` | number | no | `4500` | — |
| `wechat-mp.master` | string \| number | no | — | 框架 master（WeChat OpenID；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `wechat-mp.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `wechat-mp.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `wechat-mp.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（WeChat OpenID）；覆盖顶层 master |
| `wechat-mp.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `wechat-mp.endpoints[].appId` | string | yes | — | WeChat MP app ID |
| `wechat-mp.endpoints[].appSecret` | string | yes | — | WeChat MP app secret |
| `wechat-mp.endpoints[].token` | string | yes | — | WeChat MP callback token |
| `wechat-mp.endpoints[].encodingAESKey` | string | no | — | WeChat MP encoding AES key |
| `wechat-mp.endpoints[].path` | string | no | — | — |
| `wechat-mp.endpoints[].encrypt` | boolean | no | — | — |
| `wechat-mp.endpoints[].encryptMode` | string: `"plain"`, `"compatible"`, `"secure"` | no | — | — |
| `wechat-mp.endpoints[].replyMode` | string: `"passive"`, `"customer_service"` | no | — | — |
| `wechat-mp.endpoints[].passiveReplyTimeoutMs` | number | no | — | — |
| `wechat-mp.endpoints[].commandPrefix` | string | no | — | — |
| `wechat-mp.endpoints[].id` | string | yes | — | WeChat MP bot name |
| `wechat-mp.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wecom

[`plugins/adapters/wecom/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wecom/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `wecom.webhookPath` | string | no | `"/wecom/callback"` | — |
| `wecom.apiBaseUrl` | string | no | `"https://qyapi.weixin.qq.com"` | — |
| `wecom.master` | string \| number | no | — | 框架 master（WeCom userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `wecom.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `wecom.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `wecom.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（WeCom userid）；覆盖顶层 master |
| `wecom.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `wecom.endpoints[].corpId` | string | yes | — | WeCom corp ID |
| `wecom.endpoints[].agentSecret` | string | yes | — | WeCom agent secret |
| `wecom.endpoints[].token` | string | yes | — | WeCom callback token |
| `wecom.endpoints[].encodingAESKey` | string | yes | — | WeCom encoding AES key |
| `wecom.endpoints[].webhookPath` | string | no | — | — |
| `wecom.endpoints[].apiBaseUrl` | string | no | — | — |
| `wecom.endpoints[].commandPrefix` | string | no | — | — |
| `wecom.endpoints[].id` | string | yes | — | WeCom bot name |
| `wecom.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### weixin-ilink

[`plugins/adapters/weixin-ilink/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/weixin-ilink/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `weixin-ilink.botAgent` | string | no | — | — |
| `weixin-ilink.baseUrl` | string | no | `"https://ilinkai.weixin.qq.com"` | — |
| `weixin-ilink.cdnBaseUrl` | string | no | `"https://novac2c.cdn.weixin.qq.com/c2c"` | — |
| `weixin-ilink.longPollTimeoutMs` | number | no | `35000` | — |
| `weixin-ilink.dataDir` | string | no | `"data/weixin-ilink"` | Endpoint state root for credentials, cursors, context tokens, and media |
| `weixin-ilink.master` | string \| number | no | — | 框架 master（Weixin user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `weixin-ilink.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `weixin-ilink.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `weixin-ilink.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Weixin user id）；覆盖顶层 master |
| `weixin-ilink.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `weixin-ilink.endpoints[].botToken` | string | no | — | iLink bot token; omit to load endpoint state or start QR login |
| `weixin-ilink.endpoints[].id` | string | yes | — | Weixin iLink bot name |
| `weixin-ilink.endpoints[].botAgent` | string | no | — | — |
| `weixin-ilink.endpoints[].baseUrl` | string | no | — | — |
| `weixin-ilink.endpoints[].cdnBaseUrl` | string | no | — | — |
| `weixin-ilink.endpoints[].longPollTimeoutMs` | number | no | — | — |
| `weixin-ilink.endpoints[].dataDir` | string | no | — | Endpoint state root |
| `weixin-ilink.endpoints[].commandPrefix` | string | no | — | 本 endpoint 的命令前缀 |
| `weixin-ilink.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### process-monitor

[`plugins/features/process-monitor/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/features/process-monitor/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `process-monitor.enabled` | boolean | no | `true` | 是否启用进程监控 |
| `process-monitor.notifyOnStart` | boolean | no | `true` | 首次启动时通知 |
| `process-monitor.notifyOnRestart` | boolean | no | `true` | 正常重启时通知 |
| `process-monitor.notifyOnCrash` | boolean | no | `true` | 异常崩溃重启时通知 |
| `process-monitor.notifyChannels` | array&lt;object&gt; | no | `[]` | 通知渠道（slice-1 仅 webhook 生效） |
| `process-monitor.notifyChannels[].type` | string: `"webhook"` | yes | — | — |
| `process-monitor.notifyChannels[].target` | string | yes | — | — |

### blackjack

[`plugins/games/blackjack/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/blackjack/schema.json)

_This Schema declares no fields._

### dice-duel

[`plugins/games/dice-duel/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/dice-duel/schema.json)

_This Schema declares no fields._

### dungeon-expedition

[`plugins/games/dungeon-expedition/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/dungeon-expedition/schema.json)

_This Schema declares no fields._

### guess-number

[`plugins/games/guess-number/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/guess-number/schema.json)

_This Schema declares no fields._

### hub

[`plugins/games/hub/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/hub/schema.json)

_This Schema declares no fields._

### idiom-chain

[`plugins/games/idiom-chain/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/idiom-chain/schema.json)

_This Schema declares no fields._

### roulette

[`plugins/games/roulette/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/roulette/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `roulette.chambers` | integer | no | `6` | 弹巢数量，其中一发是实弹 |
| `roulette.maxPlayers` | integer | no | `6` | 单局最多玩家数 |
| `roulette.turnTimeoutSeconds` | integer | no | `60` | 轮到的玩家超过这个秒数不开枪，判负 |
| `roulette.lobbyTimeoutSeconds` | integer | no | `300` | 开局后超过这个秒数仍未开始，自动解散 |
| `roulette.muteSeconds` | integer | no | `60` | 开启禁言惩罚的群里，输家被禁言的秒数（每个群默认关闭） |

### rps

[`plugins/games/rps/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/rps/schema.json)

_This Schema declares no fields._

### text-adventure

[`plugins/games/text-adventure/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/text-adventure/schema.json)

_This Schema declares no fields._

### tic-tac-toe

[`plugins/games/tic-tac-toe/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/tic-tac-toe/schema.json)

_This Schema declares no fields._

### word-riddle

[`plugins/games/word-riddle/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/word-riddle/schema.json)

_This Schema declares no fields._

### activity-feedback

[`plugins/services/activity-feedback/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/services/activity-feedback/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `activity-feedback.enabled` | boolean | no | `true` | Enable activity feedback for this plugin instance. |
| `activity-feedback.defaults` | object | no | — | Default policy for all platforms and Endpoints. |
| `activity-feedback.defaults.enabled` | boolean | no | `true` | Enable this policy layer. |
| `activity-feedback.defaults.phases` | object | no | — | Feedback policy keyed by lifecycle phase. |
| `activity-feedback.defaults.phases.queued` | object | no | — | — |
| `activity-feedback.defaults.phases.queued.private` | object | no | — | — |
| `activity-feedback.defaults.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.queued.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.queued.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.queued.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.queued.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.queued.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.queued.group` | object | no | — | — |
| `activity-feedback.defaults.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.queued.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.queued.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.queued.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.queued.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.queued.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.queued.channel` | object | no | — | — |
| `activity-feedback.defaults.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.queued.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.queued.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.queued.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.queued.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.queued.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.active` | object | no | — | — |
| `activity-feedback.defaults.phases.active.private` | object | no | — | — |
| `activity-feedback.defaults.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.active.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.active.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.active.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.active.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.active.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.active.group` | object | no | — | — |
| `activity-feedback.defaults.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.active.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.active.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.active.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.active.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.active.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.active.channel` | object | no | — | — |
| `activity-feedback.defaults.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.active.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.active.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.active.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.active.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.active.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.thinking` | object | no | — | — |
| `activity-feedback.defaults.phases.thinking.private` | object | no | — | — |
| `activity-feedback.defaults.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.thinking.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.thinking.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.thinking.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.thinking.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.thinking.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.thinking.group` | object | no | — | — |
| `activity-feedback.defaults.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.thinking.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.thinking.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.thinking.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.thinking.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.thinking.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.thinking.channel` | object | no | — | — |
| `activity-feedback.defaults.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.thinking.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.thinking.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.thinking.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.thinking.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.thinking.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_start` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_start.private` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_start.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_start.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_start.group` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_start.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_start.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_start.channel` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_start.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_finish` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_finish.private` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_finish.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_finish.group` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_finish.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_finish.channel` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_finish.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_error` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_error.private` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_error.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_error.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_error.group` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_error.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_error.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.defaults.phases.schedule_error.channel` | object | no | — | — |
| `activity-feedback.defaults.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.defaults.phases.schedule_error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.defaults.phases.schedule_error.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.defaults.phases.schedule_error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.defaults.phases.schedule_error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.defaults.phases.schedule_error.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms` | object | no | — | Platform overrides keyed by platform name; values use the same shape as defaults. |
| `activity-feedback.platforms.<platform>.enabled` | boolean | no | `true` | Enable this policy layer. |
| `activity-feedback.platforms.<platform>.phases` | object | no | — | Feedback policy keyed by lifecycle phase. |
| `activity-feedback.platforms.<platform>.phases.queued` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.private` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.queued.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.queued.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.queued.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.queued.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.queued.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.queued.group` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.queued.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.queued.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.queued.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.queued.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.queued.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.queued.channel` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.queued.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.queued.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.queued.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.queued.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.queued.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.active` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.active.private` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.active.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.active.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.active.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.active.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.active.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.active.group` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.active.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.active.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.active.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.active.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.active.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.active.channel` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.active.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.active.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.active.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.active.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.active.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.thinking` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.private` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.thinking.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.thinking.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.thinking.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.thinking.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.thinking.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.thinking.group` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.thinking.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.thinking.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.thinking.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.thinking.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.thinking.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.thinking.channel` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_start` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_error` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel` | object | no | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints` | object | no | — | Endpoint overrides keyed by platform:endpointKey; values use the same shape as defaults. |
| `activity-feedback.endpoints.<platform:endpointKey>.enabled` | boolean | no | `true` | Enable this policy layer. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases` | object | no | — | Feedback policy keyed by lifecycle phase. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel` | object | no | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule` | object | no | — | Schedule-only start, finish, and error feedback. |
| `activity-feedback.schedule.phases` | object | no | — | — |
| `activity-feedback.schedule.phases.start` | object | no | — | — |
| `activity-feedback.schedule.phases.start.private` | object | no | — | — |
| `activity-feedback.schedule.phases.start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.start.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.start.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.start.group` | object | no | — | — |
| `activity-feedback.schedule.phases.start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.start.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.start.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.start.channel` | object | no | — | — |
| `activity-feedback.schedule.phases.start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.start.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.finish` | object | no | — | — |
| `activity-feedback.schedule.phases.finish.private` | object | no | — | — |
| `activity-feedback.schedule.phases.finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.finish.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.finish.group` | object | no | — | — |
| `activity-feedback.schedule.phases.finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.finish.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.finish.channel` | object | no | — | — |
| `activity-feedback.schedule.phases.finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.finish.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.error` | object | no | — | — |
| `activity-feedback.schedule.phases.error.private` | object | no | — | — |
| `activity-feedback.schedule.phases.error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.error.private.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.error.private.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.error.group` | object | no | — | — |
| `activity-feedback.schedule.phases.error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.error.group.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.error.group.platformConfig` | object | no | — | Platform-specific options. |
| `activity-feedback.schedule.phases.error.channel` | object | no | — | — |
| `activity-feedback.schedule.phases.error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `activity-feedback.schedule.phases.error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `activity-feedback.schedule.phases.error.channel.message` | string | no | — | Status text for type=message. |
| `activity-feedback.schedule.phases.error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `activity-feedback.schedule.phases.error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `activity-feedback.schedule.phases.error.channel.platformConfig` | object | no | — | Platform-specific options. |

### typesafe

[`plugins/services/typesafe/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/services/typesafe/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `typesafe.enabled` | boolean | no | `true` | Enable this decision provider. |
| `typesafe.apiKey` | string | no | — | TypeSafe API key; reference TYPESAFE_API_KEY from the environment. |
| `typesafe.model` | string | no | `"jev-latest"` | Model name; pin a model version for calibrated policies. |
| `typesafe.baseUrl` | string | no | `"https://api.typesafe.ai"` | API root URL without query, credentials or fragment. |
| `typesafe.timeoutMs` | integer | no | `10000` | Total budget including all requests and retry delays. |
| `typesafe.maxRetries` | integer | no | `2` | Maximum SDK retries after the first attempt. |

### 60s

[`plugins/utils/60s/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/60s/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `60s.apiBase` | string | no | `"https://60s.viki.moe"` | 60s API base URL |

### answers

[`plugins/utils/answers/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/answers/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `answers.dailyStable` | boolean | no | `false` | 同一用户同一天问同一个问题时，答案之书给出相同答案 |
| `answers.timezone` | string | no | `"Asia/Shanghai"` | dailyStable 判断「同一天」所用的 IANA 时区 |
| `answers.quizTimeoutSeconds` | number | no | `120` | 出题后等待作答的秒数，超时题目作废 |
| `answers.enableDrivingQuiz` | boolean | no | `true` | 启用「科目一」交规小测（原创题面，仅供娱乐参考） |

### bilibili

[`plugins/utils/bilibili/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/bilibili/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `bilibili.pollCron` | string | no | `"0 * * * * *"` | 轮询频率（6 段 Cron，默认每 60 秒） / Poll schedule (6-field cron, default every 60s) |
| `bilibili.jitterMs` | number | no | `15000` | 每轮轮询前的随机延迟上限（毫秒） / Max random delay before each poll (ms) |
| `bilibili.requestGapMs` | number | no | `1500` | 同一轮内相邻动态请求的间隔（毫秒） / Gap between dynamic requests within one poll (ms) |
| `bilibili.maxBackoffMinutes` | number | no | `30` | 接口失败或风控时指数退避的上限（分钟） / Upper bound of exponential backoff (minutes) |
| `bilibili.maxPerChannel` | number | no | `20` | 每个会话最多订阅的 UP 主数量 / Max UP subscriptions per conversation |
| `bilibili.timeout` | number | no | `10000` | 单次 HTTP 请求超时（毫秒） / HTTP timeout (ms) |
| `bilibili.live` | boolean | no | `true` | 是否轮询开播状态 / Poll live status |
| `bilibili.dynamic` | boolean | no | `true` | 是否轮询 UP 主动态 / Poll UP dynamics |
| `bilibili.cookie` | string | no | `""` | 可选的 B 站 Cookie（如 SESSDATA=...），风控严格时使用，请写成 ${BILIBILI_COOKIE} / Optional cookie, reference it as ${BILIBILI_COOKIE} |

### calendar

[`plugins/utils/calendar/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/calendar/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `calendar.provider` | `"none"` \| `"caldav"` \| `"google"` \| `"microsoft"` | no | `"none"` | 日历后端；none 时工具返回未启用提示 |
| `calendar.timezone` | string | no | `"Asia/Manila"` | 解释无偏移时间与展示用的 IANA 时区 |
| `calendar.work_day_start` | string | no | `"09:00"` | — |
| `calendar.work_day_end` | string | no | `"18:00"` | — |
| `calendar.oauth_redirect_base_url` | string | no | `""` | 聊天授权回调的外部基础地址（如 https://bot.example.com）；留空时使用 zhin HTTP Host 的本机地址 |
| `calendar.oauth_callback_path` | string | no | `"/calendar/oauth/callback"` | 聊天授权回调路由，挂在 zhin HTTP Host 上；反向代理/隧道只转发部分路径时可调整 |
| `calendar.caldav` | object | no | — | — |
| `calendar.caldav.enabled` | boolean | no | `false` | — |
| `calendar.caldav.calendar_url` | string | no | `""` | 日历 collection URL |
| `calendar.caldav.username` | string | no | `""` | — |
| `calendar.caldav.password` | string | no | `""` | — |
| `calendar.google` | object | no | — | — |
| `calendar.google.enabled` | boolean | no | `false` | — |
| `calendar.google.client_id` | string | no | `""` | ${GOOGLE_CALENDAR_CLIENT_ID} |
| `calendar.google.client_secret` | string | no | `""` | ${GOOGLE_CALENDAR_CLIENT_SECRET} |
| `calendar.google.refresh_token` | string | no | `""` | ${GOOGLE_CALENDAR_REFRESH_TOKEN}；用 auth google 获取 |
| `calendar.google.calendar_id` | string | no | `"primary"` | 日历 ID，默认 primary；可换成其它日历的 id |
| `calendar.google.token_file` | string | no | `""` | 可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-google-token.json） |
| `calendar.microsoft` | object | no | — | — |
| `calendar.microsoft.enabled` | boolean | no | `false` | — |
| `calendar.microsoft.client_id` | string | no | `""` | ${MS_GRAPH_CLIENT_ID} |
| `calendar.microsoft.client_secret` | string | no | `""` | 可选；公共客户端可留空。${MS_GRAPH_CLIENT_SECRET} |
| `calendar.microsoft.refresh_token` | string | no | `""` | ${MS_GRAPH_REFRESH_TOKEN}；用 auth microsoft 获取 |
| `calendar.microsoft.tenant` | string | no | `"common"` | Azure tenant，默认 common |
| `calendar.microsoft.calendar_id` | string | no | `""` | 留空或 primary/me = 默认日历；否则为 Graph calendar id |
| `calendar.microsoft.token_file` | string | no | `""` | 可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-ms-token.json） |

### code-runner

[`plugins/utils/code-runner/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/code-runner/schema.json)

_This Schema declares no fields._

### content-moderation

[`plugins/utils/content-moderation/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/content-moderation/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `content-moderation.groupModeration` | array&lt;object&gt; | no | `[]` | 自动广告/辱骂审核的精确范围；未配置时关闭。需要 AI、原子持久状态和适配器群管支持。 |
| `content-moderation.groupModeration[].adapter` | string | yes | — | — |
| `content-moderation.groupModeration[].endpoint` | string | yes | — | — |
| `content-moderation.groupModeration[].account` | string | yes | — | — |
| `content-moderation.groupModeration[].group` | string | yes | — | — |
| `content-moderation.enabled` | boolean | no | `true` | 总开关 |
| `content-moderation.onError` | string: `"open"`, `"closed"` | no | `"open"` | 审查源失败时的全局默认策略：open=视为通过，closed=视为 critical |
| `content-moderation.maskChar` | string | no | `"*"` | 文本打码字符 |
| `content-moderation.replyTemplate` | string | no | `"消息含不当内容，已拦截。"` | reply 动作时的提示文案 |
| `content-moderation.masters` | array&lt;string&gt; | no | `[]` | 额外视为 master 的 userId（兜底，与 endpoint master 合并） |
| `content-moderation.inbound` | object | no | — | — |
| `content-moderation.inbound.enabled` | boolean | no | `true` | — |
| `content-moderation.inbound.bypassMasters` | boolean | no | `true` | master 跳过入站审查 |
| `content-moderation.inbound.whitelist` | object | no | — | — |
| `content-moderation.inbound.whitelist.userIds` | array&lt;string&gt; | no | `[]` | — |
| `content-moderation.inbound.whitelist.conversationIds` | array&lt;string&gt; | no | `[]` | — |
| `content-moderation.outbound` | object | no | — | — |
| `content-moderation.outbound.enabled` | boolean | no | `true` | — |
| `content-moderation.outbound.bypass` | boolean | no | `false` | 为 true 时跳过出站审查 |
| `content-moderation.actions` | object | no | — | severity → 动作（字符串或数组）；缺省用偏严默认表 |
| `content-moderation.actions.pass` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `content-moderation.actions.low` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `content-moderation.actions.medium` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `content-moderation.actions.high` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `content-moderation.actions.critical` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `content-moderation.sources` | array&lt;object&gt; | no | `[]` | — |
| `content-moderation.sources[].id` | string | yes | — | — |
| `content-moderation.sources[].type` | string: `"local"`, `"http"` | yes | — | — |
| `content-moderation.sources[].enabled` | boolean | no | `true` | — |
| `content-moderation.sources[].onError` | string: `"open"`, `"closed"` | no | — | — |
| `content-moderation.sources[].includeBuiltin` | boolean | no | `true` | 是否合并内置分级违禁词词库 |
| `content-moderation.sources[].words` | array&lt;string \| object&gt; | no | `[]` | 自定义词：字符串（用 defaultSeverity）或 { word, severity } |
| `content-moderation.sources[].wordFiles` | array&lt;string&gt; | no | `[]` | 词库文件；行格式 word / severity:word / word\|severity |
| `content-moderation.sources[].defaultSeverity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | no | `"high"` | 未标注分级的自定义词默认 severity |
| `content-moderation.sources[].severity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | no | `"high"` | 兼容旧字段，等同 defaultSeverity |
| `content-moderation.sources[].url` | string | no | — | — |
| `content-moderation.sources[].headers` | object | no | — | — |
| `content-moderation.sources[].timeoutMs` | number | no | `5000` | — |
| `content-moderation.sources[].forceUpload` | boolean | no | `false` | 强制下载图片后上传，不传 URL |

### earthquake

[`plugins/utils/earthquake/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/earthquake/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `earthquake.sources` | array&lt;string: `"cenc"`, `"usgs"`&gt; | no | `["cenc","usgs"]` | 启用的数据源及优先顺序；合并同一地震时排在前面的数据源提供地点文字，某个数据源失败时由其余数据源兜底 |
| `earthquake.cencUrls` | array&lt;string&gt; | no | `["https://api.wolfx.jp/cenc_eqlist.json","https://ceic.ac.cn/data/data.json"]` | CENC 地震目录地址，按顺序尝试（首个为主源，其余为备用镜像）；仅支持 HTTPS，最多 5 个 |
| `earthquake.usgsFeed` | string: `"significant_hour"`, `"significant_day"`, `"4.5_hour"`, `"4.5_day"`, `"2.5_hour"`, `"2.5_day"`, `"1.0_hour"`, `"1.0_day"` | no | `"2.5_day"` | USGS GeoJSON 汇总源名称（震级下限_时间范围） |
| `earthquake.pollCron` | string | no | `"0 */2 * * * *"` | 订阅轮询频率（6 段 Cron：秒 分 时 日 月 周） |
| `earthquake.timezone` | string | no | `"Asia/Shanghai"` | 显示发震时刻使用的 IANA 时区 |
| `earthquake.requestTimeoutMs` | number | no | `10000` | 单次 HTTP 请求超时（毫秒） |
| `earthquake.maxRetries` | number | no | `2` | 网络错误、超时、429 与 5xx 的重试次数（不含首次请求） |
| `earthquake.retryBaseDelayMs` | number | no | `1000` | 指数退避的首次等待（毫秒），每次重试翻倍并加入随机抖动 |
| `earthquake.retryMaxDelayMs` | number | no | `30000` | 单次退避或 Retry-After 等待上限（毫秒）；服务端要求更久时本轮放弃并冷却该数据源 |
| `earthquake.defaultMinMagnitude` | number | no | `5` | 订阅未指定震级时使用的最小震级 |
| `earthquake.queryMinMagnitude` | number | no | `3` | 「地震」查询未指定震级时使用的最小震级 |
| `earthquake.queryLimit` | number | no | `5` | 「地震」查询默认列出的条数 |
| `earthquake.maxEventAgeMinutes` | number | no | `60` | 只推送发震时间在此分钟数以内的地震，避免推送迟到或重放的旧事件 |
| `earthquake.pushLimit` | number | no | `3` | 每个会话在一个限流窗口内最多推送的消息数 |
| `earthquake.pushWindowMinutes` | number | no | `10` | 推送限流窗口长度（分钟） |
| `earthquake.maxEventsPerMessage` | number | no | `5` | 单条推送消息最多列出的地震数，其余以数量概括 |
| `earthquake.maxSubscriptions` | number | no | `100` | 本实例所有会话的订阅总数上限（每个会话最多一个订阅） |

### group-suite

[`plugins/utils/group-suite/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `group-suite.keywordReply` | boolean | no | `false` | — |
| `group-suite.basePointsMin` | number | no | `10` | — |
| `group-suite.basePointsMax` | number | no | `30` | — |
| `group-suite.streakBonus` | number | no | `5` | — |
| `group-suite.streakCap` | number | no | `50` | — |
| `group-suite.rankSize` | number | no | `10` | — |
| `group-suite.teachMaxPerGroup` | number | no | `200` | — |
| `group-suite.teachCooldownMs` | number | no | `3000` | — |
| `group-suite.teachAllowRegex` | boolean | no | `true` | — |
| `group-suite.teachPageSize` | number | no | `10` | — |
| `group-suite.welcomeMessage` | string | no | `""` | Group welcome text. Empty disables; {name}/{id} refer to the joined member. |
| `group-suite.welcomeConversations` | array&lt;object&gt; | no | — | Exact welcome conversations. Omitted welcomes all groups; [] welcomes none. Missing parent/thread requires their absence; no wildcards. |
| `group-suite.welcomeConversations[].endpoint` | object | yes | — | — |
| `group-suite.welcomeConversations[].endpoint.adapter` | string | yes | — | — |
| `group-suite.welcomeConversations[].endpoint.id` | string | yes | — | — |
| `group-suite.welcomeConversations[].kind` | string: `"group"` | yes | — | — |
| `group-suite.welcomeConversations[].id` | string | yes | — | — |
| `group-suite.welcomeConversations[].parent` | object | no | — | — |
| `group-suite.welcomeConversations[].parent.kind` | string: `"private"`, `"group"`, `"channel"` | yes | — | — |
| `group-suite.welcomeConversations[].parent.id` | string | yes | — | — |
| `group-suite.welcomeConversations[].threadId` | string | no | — | — |
| `group-suite.ephemeralKeywords` | boolean | no | `false` | Explicit volatile keywords. With false, automatic replies require Database Host at startup and keyword management requires its persistent state service when invoked. |

### ledger

[`plugins/utils/ledger/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/ledger/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `ledger.timezone` | string | no | `"Asia/Shanghai"` | 计算今日、本周（周一开始）、本月与日报日期所用的 IANA 时区 |
| `ledger.reportTime` | string | no | `"22:00"` | 记账日报的发送时间（HH:MM，按 timezone）；只发给用「记账日报 开启」订阅的用户 |
| `ledger.reportWhenEmpty` | boolean | no | `false` | 当天没有记账时是否仍发送日报 |

### link-poster

[`plugins/utils/link-poster/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/link-poster/schema.json)

_This Schema declares no fields._

### lottery

[`plugins/utils/lottery/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/lottery/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `lottery.pickCount` | number | no | `5` | — |
| `lottery.scheduleCron` | string | no | `"0 0 18 * * *"` | — |
| `lottery.historyLimit` | number | no | `500` | — |
| `lottery.scheduleEnabled` | boolean | no | `true` | — |
| `lottery.backtestEnabled` | boolean | no | `true` | — |
| `lottery.backtestWindow` | number | no | `50` | — |
| `lottery.backtestRandomTrials` | number | no | `64` | — |
| `lottery.backtestMinHistory` | number | no | `30` | — |
| `lottery.backtestAdaptive` | boolean | no | `true` | — |
| `lottery.weightPersistEnabled` | boolean | no | `true` | — |
| `lottery.weightHoldoutFallback` | boolean | no | `true` | — |
| `lottery.games` | array&lt;string&gt; | no | `["kl8","ssq","dlt","fc3d","pl3","pl5"]` | — |
| `lottery.pushTargets` | array&lt;object&gt; | no | `[]` | OutboundHost push destinations for cron/publish reports |
| `lottery.pushTargets[].adapter` | string | yes | — | — |
| `lottery.pushTargets[].endpointId` | string | no | — | — |
| `lottery.pushTargets[].channelType` | string | no | `"private"` | — |
| `lottery.pushTargets[].channelId` | string | yes | — | — |
| `lottery.kl8` | object | no | — | — |
| `lottery.kl8.pickCount` | number | no | `5` | — |
| `lottery.kl8.recommendGroups` | number | no | `3` | — |
| `lottery.kl8.groupStrategies` | array&lt;string&gt; | no | `["balanced","hot","cold"]` | — |

### music

[`plugins/utils/music/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/music/schema.json)

_This Schema declares no fields._

### nettools

[`plugins/utils/nettools/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/nettools/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `nettools.cooldownSeconds` | integer | no | `10` | Per-user cooldown in seconds, shared by all nettools commands and tools (0 disables) |
| `nettools.requestTimeoutMs` | integer | no | `8000` | Per-attempt timeout for each external HTTP request, in milliseconds |
| `nettools.maxRetries` | integer | no | `2` | Retries for transient failures (network errors, timeouts, 429, 5xx) with exponential backoff and jitter |
| `nettools.pingMaxNodes` | integer | no | `4` | Number of check-host.net probe nodes used by ping |
| `nettools.pingPollIntervalMs` | integer | no | `2000` | Wait between ping result polls, in milliseconds |
| `nettools.pingMaxPolls` | integer | no | `5` | Maximum number of ping result polls before reporting partial results |
| `nettools.dohProviders` | array&lt;string: `"cloudflare"`, `"alidns"`, `"google"`&gt; | no | `["cloudflare","alidns","google"]` | DNS-over-HTTPS providers in fallback order |
| `nettools.priceListLimit` | integer | no | `8` | Number of registrars shown in a domain price comparison |

### qrcode

[`plugins/utils/qrcode/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/qrcode/schema.json)

_This Schema declares no fields._

### reminder

[`plugins/utils/reminder/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/reminder/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `reminder.timezone` | string | no | `"UTC"` | 解释 create 自然时间并显示提醒的 IANA 时区；ISO 绝对时间仍须显式 offset |
| `reminder.maxTasks` | number | no | `20` | 每实例聊天个人提醒池的活跃任务上限；与管理员池独立，降低上限不删除既有任务 |
| `reminder.adminMaxTasks` | number | no | `20` | 每实例管理员提醒池的活跃任务上限（待执行、暂停或未确认）；与聊天池独立，两池总量可达上限之和 |
| `reminder.maxTasksPerSender` | number | no | `10` | 同一发送者在同一会话的任务上限 |
| `reminder.batchSize` | number | no | `5` | 每次扫描最多投递的任务数 |
| `reminder.missedGraceSeconds` | number | no | `15` | 周期轮次超过此延迟后跳过；停机期间不补历史轮次 |

### repeater

[`plugins/utils/repeater/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/repeater/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `repeater.threshold` | number | no | `3` | 触发复读的最少人数 |
| `repeater.cooldown` | number | no | `30000` | 同一群冷却时间 (ms) |
| `repeater.maxLength` | number | no | `200` | 消息长度上限 |

### rss

[`plugins/utils/rss/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/rss/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `rss.pollCron` | string | no | `"0 */5 * * * *"` | 轮询频率 (6 段 Cron 表达式) |
| `rss.maxPerGroup` | number | no | `30` | — |
| `rss.maxItems` | number | no | `5` | — |
| `rss.timeout` | number | no | `15000` | — |

### short-url

[`plugins/utils/short-url/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/short-url/schema.json)

_This Schema declares no fields._
