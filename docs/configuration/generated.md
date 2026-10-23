---
title: 自动生成配置字段参考
outline: [2, 3]
---

# 自动生成配置字段参考

> 本页由源码与 JSON Schema 自动生成，请勿手工编辑。叙事、示例与配置方法见[配置参考](./)。

- 生成命令: `pnpm docs:config`
- 漂移检查: `pnpm check:config-reference`

## Host 顶层字段

权威契约来自 Runtime 实际消费的 [`packages/im/runtime/src/host-config-schema.json`](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json)；消费位置见 [`basic/cli/src/plugin-runtime/console/configuration-projection.ts`](https://github.com/zhinjs/zhin/blob/main/basic/cli/src/plugin-runtime/console/configuration-projection.ts)。

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `http` | object | 否 | — | HTTP、Console、REST/RPC/SSE 与 Webhook Host。 |
| `http.readiness` | object | 否 | — | /pub/ready 要求就绪的运行时组件；不执行外部网络探测。 |
| `http.readiness.database` | boolean | 否 | `true` | 要求 Database Host 已初始化（不执行实时数据库查询）。 |
| `http.readiness.endpoints` | array&lt;object&gt; | 否 | — | 必须开放入站的 Endpoint，按插件 owner 与稳定槽名精确选择。 |
| `http.readiness.endpoints[].owner` | string | 是 | — | — |
| `http.readiness.endpoints[].name` | string | 是 | — | — |
| `http.readiness.agents` | array&lt;string&gt; | 否 | — | 必须存在的 Agent binding；不验证模型凭据或 Provider 网络可用性。 |
| `http.host` | string \| null | 否 | — | 监听地址。 |
| `http.port` | number \| string \| null | 否 | — | 监听端口。 |
| `http.token` | string \| null | 否 | — | HTTP Host 访问令牌。 |
| `http.tokens` | array \| null | 否 | — | — |
| `http.corsOrigins` | array \| null | 否 | — | — |
| `http.base` | string \| null | 否 | — | API 路径前缀。 |
| `http.tls` | `false` \| null \| object | 否 | — | — |
| `http.listeners` | array&lt;object&gt; | 否 | — | — |
| `http.listeners[].enabled` | boolean \| string | 否 | — | 是否启用此监听器。 |
| `http.listeners[].host` | string | 否 | — | 监听地址。 |
| `http.listeners[].port` | number \| string | 否 | — | 监听端口。 |
| `http.listeners[].tls` | `false` \| null \| object | 否 | — | — |
| `database` | object | 否 | — | Database Host 与方言连接参数。 |
| `database.dialect` | string | 否 | — | 数据库方言。 |
| `database.filename` | string | 否 | — | SQLite 文件路径。 |
| `database.mode` | string | 否 | — | SQLite 兼容模式字段。 |
| `database.host` | string | 否 | — | 数据库主机。 |
| `database.port` | number \| string | 否 | — | 网络数据库端口。 |
| `database.user` | string | 否 | — | MySQL / PostgreSQL 用户名。 |
| `database.username` | string | 否 | — | Redis 用户名。 |
| `database.password` | string | 否 | — | 连接密码。 |
| `database.database` | string \| number | 否 | — | MySQL / PostgreSQL 数据库名，或 Redis 数据库索引。 |
| `database.uri` | string | 否 | — | MySQL 连接 URI（可能含凭据）。 |
| `database.connectionString` | string | 否 | — | PostgreSQL 连接串（可能含凭据）。 |
| `database.url` | string | 否 | — | MongoDB / Redis 连接 URL（可能含凭据）。 |
| `database.dbName` | string | 否 | — | MongoDB 数据库名。 |
| `database.pool` | object \| null | 否 | — | — |
| `database.pool.min` | number \| string \| null | 否 | — | 最少连接数。 |
| `database.pool.max` | number \| string \| null | 否 | — | 最多连接数。 |
| `database.pool.acquireTimeoutMillis` | number \| string \| null | 否 | — | 获取连接超时毫秒。 |
| `database.pool.idleTimeoutMillis` | number \| string \| null | 否 | — | 空闲连接超时毫秒。 |
| `database.socket` | object | 否 | — | — |
| `database.socket.host` | string | 否 | — | Redis 主机。 |
| `database.socket.port` | number \| string | 否 | — | Redis 端口。 |
| `database.socket.path` | string | 否 | — | Unix socket 路径。 |
| `database.socket.connectTimeout` | number \| string | 否 | — | 连接超时毫秒。 |
| `database.socket.tls` | boolean \| string | 否 | — | 启用 TLS。 |
| `database.socket.keepAlive` | number \| string | 否 | — | TCP keep-alive 毫秒。 |
| `database.socket.noDelay` | boolean \| string | 否 | — | TCP noDelay。 |
| `database.ssl` | boolean \| string \| object | 否 | — | — |
| `database.charset` | string | 否 | — | MySQL 字符集。 |
| `database.timezone` | string | 否 | — | MySQL 时区。 |
| `database.connectTimeout` | number \| string | 否 | — | MySQL 连接超时毫秒。 |
| `database.connectionTimeoutMillis` | number \| string | 否 | — | PostgreSQL 连接超时毫秒。 |
| `database.query_timeout` | number \| string | 否 | — | PostgreSQL 查询超时毫秒。 |
| `database.statement_timeout` | number \| string | 否 | — | PostgreSQL statement 超时毫秒。 |
| `database.application_name` | string | 否 | — | PostgreSQL 应用名称。 |
| `database.maxPoolSize` | number \| string | 否 | — | MongoDB 最大连接池大小。 |
| `database.minPoolSize` | number \| string | 否 | — | MongoDB 最小连接池大小。 |
| `database.serverSelectionTimeoutMS` | number \| string | 否 | — | MongoDB server 选择超时毫秒。 |
| `database.connectTimeoutMS` | number \| string | 否 | — | MongoDB 连接超时毫秒。 |
| `database.socketTimeoutMS` | number \| string | 否 | — | MongoDB socket 超时毫秒。 |
| `database.authSource` | string | 否 | — | MongoDB 认证数据库。 |
| `database.replicaSet` | string | 否 | — | MongoDB 副本集。 |
| `database.auth` | object | 否 | — | — |
| `database.auth.username` | string | 否 | — | MongoDB 用户名。 |
| `database.auth.password` | string | 否 | — | MongoDB 密码。 |
| `database.disableOfflineQueue` | boolean \| string | 否 | — | Redis 禁止离线队列。 |
| `database.pingInterval` | number \| string | 否 | — | Redis 心跳间隔毫秒。 |
| `ai` | object | 否 | — | Provider、Agent、会话、记忆、工具与执行安全策略。 |
| `ai.decisions` | object | 否 | — | 可选的结构化决策服务。未配置的任务关闭；建议先用 shadow 验证。 |
| `ai.decisions.provider` | string | 是 | — | 提供已启用 DecisionProvider 的精确插件身份，例如 root/typesafe。 |
| `ai.decisions.skills` | object | 否 | — | — |
| `ai.decisions.skills.mode` | string: `"off"`, `"shadow"`, `"active"` | 是 | — | — |
| `ai.decisions.skills.timeoutMs` | integer | 否 | — | — |
| `ai.decisions.skills.minConfidence` | number | 否 | — | — |
| `ai.decisions.skills.topK` | integer | 否 | — | — |
| `ai.decisions.skills.maxCandidates` | integer | 否 | — | — |
| `ai.decisions.skills.maxSelections` | integer | 否 | — | — |
| `ai.decisions.tools` | object | 否 | — | — |
| `ai.decisions.tools.mode` | string: `"off"`, `"shadow"`, `"active"` | 是 | — | — |
| `ai.decisions.tools.timeoutMs` | integer | 否 | — | — |
| `ai.decisions.tools.minConfidence` | number | 否 | — | — |
| `ai.decisions.tools.topK` | integer | 否 | — | — |
| `ai.decisions.tools.maxCandidates` | integer | 否 | — | — |
| `ai.decisions.tools.maxSelections` | integer | 否 | — | — |
| `ai.decisions.memory` | object | 否 | — | — |
| `ai.decisions.memory.mode` | string: `"off"`, `"shadow"`, `"active"` | 是 | — | — |
| `ai.decisions.memory.timeoutMs` | integer | 否 | — | — |
| `ai.decisions.memory.minConfidence` | number | 否 | — | — |
| `ai.decisions.memory.topK` | integer | 否 | — | — |
| `ai.decisions.memory.maxCandidates` | integer | 否 | — | — |
| `ai.decisions.memory.maxSelections` | integer | 否 | — | — |
| `ai.decisions.agents` | object | 否 | — | — |
| `ai.decisions.agents.mode` | string: `"off"`, `"shadow"`, `"active"` | 是 | — | — |
| `ai.decisions.agents.timeoutMs` | integer | 否 | — | — |
| `ai.decisions.agents.minConfidence` | number | 否 | — | — |
| `ai.decisions.agents.topK` | integer | 否 | — | — |
| `ai.decisions.agents.maxCandidates` | integer | 否 | — | — |
| `ai.decisions.agents.maxSelections` | integer | 否 | — | — |
| `ai.decisions.approval` | object | 否 | — | — |
| `ai.decisions.approval.mode` | string: `"off"`, `"shadow"`, `"active"` | 是 | — | — |
| `ai.decisions.approval.timeoutMs` | integer | 否 | — | — |
| `ai.decisions.approval.minConfidence` | number | 否 | — | — |
| `ai.decisions.approval.topK` | integer | 否 | — | — |
| `ai.decisions.approval.maxCandidates` | integer | 否 | — | — |
| `ai.decisions.approval.maxSelections` | integer | 否 | — | — |
| `ai.workroom` | object | 否 | — | 进程持有的 Workroom 控制面策略；Project 仍由持久化 Catalog 管理。 |
| `ai.workroom.trustedPackPublishers` | array&lt;string&gt; | 否 | — | 允许发布共享 Capability Pack 的 Console 认证 principalId。 |
| `ai.workroom.disclosure` | object | 否 | — | Workroom 披露初始化使用的显式 P12 模型处理方契约。 |
| `ai.workroom.disclosure.tenantId` | string | 否 | — | — |
| `ai.workroom.disclosure.modelProviders` | object | 否 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.endpoint` | string | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.owner` | string | 否 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.trustDomain` | string | 否 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.processingRegions` | array&lt;string&gt; | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.maxConfidentiality` | string: `"public"`, `"project_internal"`, `"confidential"`, `"restricted"` | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.external` | boolean | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.noTraining` | boolean | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.loggingMode` | string: `"disabled"`, `"metadata_only"`, `"full"` | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.maximumRetentionSeconds` | integer | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.allowsRedisclosure` | boolean | 是 | — | — |
| `ai.workroom.disclosure.modelProviders.<key>.supportsDeletion` | boolean | 是 | — | — |
| `ai.agent` | object | 否 | — | Agent 执行、排队、工具与模型策略。 |
| `ai.agent.inboundQueue` | object | 否 | — | 入站回合排队策略。 |
| `ai.agent.inboundQueue.groupMode` | string: `"supersede"`, `"fifo"` | 否 | — | supersede（默认）：同一发起人的新消息会替换他自己尚未回复的回合；fifo：全部按到达顺序排队。其他成员的消息总是排队。 |
| `ai.agent.inboundQueue.ttlMs` | integer | 否 | `180000` | 排队超过该时长的回合会被丢弃并简短提示；0 表示不过期。 |
| `ai.agent.inboundQueue.maxQueuedTurns` | integer | 否 | `5` | 同一会话中允许排在当前回合之后的回合数；超出时回复一句“正在忙”。 |
| `ai.agent.inboundQueue.coalesceWindowMs` | number \| string | 否 | — | — |
| `ai.agent.execSecurity` | string: `"deny"`, `"allowlist"`, `"full"` | 否 | — | Shell 命令安全边界。 |
| `ai.agent.execPreset` | string: `"readonly"`, `"network"`, `"development"`, `"custom"` | 否 | — | 非 full 模式使用的命令白名单预设。 |
| `ai.agent.network` | object | 否 | — | IM 回合的出网权限（web_fetch / web_search 与联网命令）。默认关闭；enabled 开启 HTTPS 出网，allowedDomains 非空时只允许这些域名。未设置 enabled 时兼容旧配置：execPreset: network 视为开启。 |
| `ai.agent.network.enabled` | boolean | 否 | `false` | 是否允许 IM 回合 HTTPS 出网。 |
| `ai.agent.network.allowedDomains` | array&lt;string&gt; | 否 | — | 非空时只允许访问这些域名（含子域名）。 |
| `ai.agent.masterShell` | string: `"off"`, `"isolated"` | 否 | `"off"` | IM 私聊中 master 的 Shell 权限。off：IM 会话不提供 bash；isolated：master 私聊在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、其余命令需审批），宿主无 Docker 时直接失败。 |
| `ai.agent.toolBudget` | object | 否 | — | 进度感知的工具调用预算。maxIterations 为软上限，回合有进展时自动延长；硬上限始终生效。 |
| `ai.agent.toolBudget.extendBy` | integer | 否 | `10` | 有进展时每次延长的步数；0 关闭。 |
| `ai.agent.toolBudget.progressWindow` | integer | 否 | `5` | 最近多少步内有进展才延长。 |
| `ai.agent.toolBudget.maxTotalIterations` | integer | 否 | `40` | 每段回合的硬步数上限。 |
| `ai.agent.toolBudget.maxSubagentTotalIterations` | integer | 否 | `30` | 回合内子 Agent 的硬步数上限。 |
| `ai.agent.toolBudget.maxWallClockMs` | integer | 否 | `600000` | 整个回合的时间上限（毫秒）；0 关闭。 |
| `ai.agent.toolBudget.maxTotalTokens` | integer | 否 | `0` | 整个回合的 Token 上限；0 关闭。 |
| `ai.agent.toolBudget.failureStreakLimit` | integer | 否 | `3` | 连续失败多少次后不再延长。 |
| `ai.agent.toolBudget.repeatLimit` | integer | 否 | `2` | 连续重复相同调用多少次后不再延长。 |
| `ai.agent.toolBudget.autoContinue` | string: `"off"`, `"master_dm"`, `"on"` | 否 | `"master_dm"` | 回合有进展但预算用尽时自动续跑：off 关闭；master_dm 仅主人私聊；on 总是。续跑沿用同一回合的策略与审批。 |
| `ai.agent.toolBudget.maxContinuations` | integer | 否 | `2` | 每回合最多自动续跑次数。 |
| `ai.agent.toolBudget.progressUpdates` | string: `"off"`, `"private"`, `"all"` | 否 | `"private"` | 长回合中的简短进度更新：off 关闭；private 仅私聊；all 包括群聊（群聊需显式开启）。 |
| `ai.agent.toolBudget.progressMinIntervalMs` | integer | 否 | `45000` | 两次进度更新的最小间隔（毫秒）。 |
| `ai.agent.toolBudget.progressMaxUpdates` | integer | 否 | `3` | 每回合最多进度更新次数；0 关闭。 |
| `ai.agent.injectionGuard` | object | 否 | — | 注入防护。外部内容（工具结果、网页、文件、子 agent 报告、群聊背景消息）进入回合后，高危动作（执行命令、向其他会话发消息、改配置、定时任务）必须审批；出站回复检查系统提示、密钥与其他会话记忆泄露。 |
| `ai.agent.injectionGuard.confirmHighRisk` | string: `"external_content"`, `"off"` | 否 | `"external_content"` | external_content：读取外部内容后的高危动作一律审批（无人值守回合直接拒绝）；off：关闭。 |
| `ai.agent.injectionGuard.outboundCheck` | string: `"redact"`, `"off"` | 否 | `"redact"` | redact：在回复和外发工具消息中屏蔽泄露的系统提示、密钥和其他会话记忆；off：关闭。 |
| `ai.agent.injectionGuard.trustedOutputTools` | array&lt;string&gt; | 否 | `[]` | 结果不算外部内容的工具。 |
| `ai.agent.usageQuota` | object | 否 | — | 按用户 / 按群的 token 配额与群速率限制。默认全部关闭（0），主人默认不受限；计数保存在内存中。 |
| `ai.agent.usageQuota.windowMs` | integer | 否 | `86400000` | 配额周期（毫秒）。 |
| `ai.agent.usageQuota.perUserTokens` | integer | 否 | `0` | 每个用户每周期可用的 token；0 不限。 |
| `ai.agent.usageQuota.perGroupTokens` | integer | 否 | `0` | 每个群每周期可用的 token；0 不限。 |
| `ai.agent.usageQuota.perGroupRequestsPerMinute` | integer | 否 | `0` | 每个群每分钟可发起的回合数；0 不限。 |
| `ai.agent.usageQuota.exemptOwner` | boolean | 否 | `true` | 主人不受限制。 |
| `ai.agent.subagentTurnMode` | string: `"off"`, `"sync"` | 否 | `"off"` | IM 回合中的子 Agent。off：不提供 spawn_task；sync：spawn_task 在当前回合内同步运行子 Agent，权限不超过父回合（父回合不能运行 bash 时子 Agent 也没有），审批发往同一会话。 |
| `ai.agent.execApprovalMode` | string: `"ask"`, `"bypass"`, `"auto"` | 否 | — | 主 Agent 命令的审批策略。 |
| `ai.agent.subagentExecApprovalMode` | string: `"ask"`, `"bypass"`, `"auto"` | 否 | — | 子 Agent 命令的审批策略。 |
| `ai.agent.workerExecApprovalMode` | string: `"ask"`, `"bypass"`, `"auto"` | 否 | — | Worker 命令的审批策略。 |
| `ai.agent.toolExecution` | string: `"parallel"`, `"sequential"`, `"tiered"` | 否 | — | 同一模型步骤中的工具调用调度方式。 |
| `ai.agent.modelSizeHint` | string: `""`, `"small"`, `"medium"`, `"large"` | 否 | — | 可选模型尺寸提示；空字符串表示清除提示。 |
| `ai.agent.promptCacheRetention` | string: `"in_memory"`, `"24h"` | 否 | — | Provider Prompt Cache 保留策略。 |
| `ai.agent.steeringMode` | string: `"one-at-a-time"`, `"all"` | 否 | — | 逐条处理 Steering 消息，或一次取出全部待处理消息。 |
| `ai.agent.followUpMode` | string: `"one-at-a-time"`, `"all"` | 否 | — | 逐条处理 Follow-up 消息，或一次取出全部待处理消息。 |
| `ai.agent.outputSchema` | boolean \| string: `"segments"` \| object | 否 | — | 最终输出默认在 IM 会话使用 segments：false 显式使用文本，true 或 segments 使用有序规范消息段，也可传入自定义 JSON Schema。隔离及非 IM 调用不应用 IM 预设。 |
| `ai.agent.schedule` | object | 否 | — | 无人值守 Schedule 执行策略。 |
| `ai.agent.schedule.security` | object | 否 | — | Schedule 命令安全策略。 |
| `ai.agent.schedule.security.execPreset` | string: `"readonly"`, `"network"` | 否 | — | Schedule Job 只能使用只读或网络预设。 |
| `ai.agent.schedule.security.allowedDomains` | array&lt;string&gt; | 否 | — | — |
| `ai.agent.schedule.budget` | object | 否 | — | — |
| `ai.agent.schedule.budget.maxTokens` | number \| string | 否 | — | — |
| `ai.agent.schedule.budget.maxToolCalls` | number \| string | 否 | — | — |
| `ai.agent.schedule.budget.timeoutMs` | number \| string | 否 | — | — |
| `ai.agent.execAllowlist` | array&lt;string&gt; | 否 | — | allowlist 模式下允许的命令（支持正则字符串，如 "^ls "、"^cat "），与 preset 合并 |
| `ai.agent.phaseTrace` | boolean \| string | 否 | — | 观测主回合阶段日志（或通过 ZHIN_AGENT_PHASE_TRACE=1 开启） |
| `ai.agent.modelHarness` | object | 否 | — | 按模型 / provider 模式覆盖 model harness |
| `ai.agent.modelHarness.models` | object | 否 | — | 模型级覆盖：支持 "gpt-4o" 或 "openai:gpt-4o" |
| `ai.agent.modelHarness.models.<key>.maxIterations` | number \| string | 否 | — | — |
| `ai.agent.modelHarness.models.<key>.explorationBudget` | number \| string | 否 | — | 连续只读探索调用达到该次数时注入提示；0 关闭 |
| `ai.agent.modelHarness.models.<key>.explorationGuidance` | boolean \| string | 否 | — | 在系统提示中加入"先规划、限定目标文件"的探索纪律 |
| `ai.agent.modelHarness.models.<key>.iterationExtension` | number \| string | 否 | — | 每次有进展时延长的步数（覆盖 toolBudget.extendBy） |
| `ai.agent.modelHarness.models.<key>.maxTotalIterations` | number \| string | 否 | — | 单段回合的硬步数上限（覆盖 toolBudget.maxTotalIterations） |
| `ai.agent.modelHarness.models.<key>.emptyReplyRetries` | number \| string | 否 | — | 空回复（无文本且无工具调用）时额外重试次数；默认 0 |
| `ai.agent.modelHarness.models.<key>.requestTimeoutMs` | number \| string | 否 | — | 单次模型请求超时（毫秒）；0 关闭 |
| `ai.agent.modelHarness.providerPatterns` | object | 否 | — | provider 模式覆盖（支持 * 通配符） |
| `ai.agent.modelHarness.providerPatterns.<key>.maxIterations` | number \| string | 否 | — | — |
| `ai.agent.modelHarness.providerPatterns.<key>.explorationBudget` | number \| string | 否 | — | 连续只读探索调用达到该次数时注入提示；0 关闭 |
| `ai.agent.modelHarness.providerPatterns.<key>.explorationGuidance` | boolean \| string | 否 | — | 在系统提示中加入"先规划、限定目标文件"的探索纪律 |
| `ai.agent.modelHarness.providerPatterns.<key>.iterationExtension` | number \| string | 否 | — | 每次有进展时延长的步数（覆盖 toolBudget.extendBy） |
| `ai.agent.modelHarness.providerPatterns.<key>.maxTotalIterations` | number \| string | 否 | — | 单段回合的硬步数上限（覆盖 toolBudget.maxTotalIterations） |
| `ai.agent.modelHarness.providerPatterns.<key>.emptyReplyRetries` | number \| string | 否 | — | 空回复（无文本且无工具调用）时额外重试次数；默认 0 |
| `ai.agent.modelHarness.providerPatterns.<key>.requestTimeoutMs` | number \| string | 否 | — | 单次模型请求超时（毫秒）；0 关闭 |
| `ai.agent.providerResilience` | object | 否 | — | Provider 韧性：重试 / 退避 / 超时 / fallback（见 ProviderResilienceConfig，默认保守） |
| `ai.agent.providerResilience.maxRetries` | number \| string | 否 | — | Retries per model after the first attempt. Default 2. `0` disables retry. |
| `ai.agent.providerResilience.baseDelayMs` | number \| string | 否 | — | First backoff delay in ms; doubles each retry. Default 1000. |
| `ai.agent.providerResilience.maxDelayMs` | number \| string | 否 | — | Upper bound for one backoff delay in ms. Default 10000. |
| `ai.agent.providerResilience.maxRetryAfterMs` | number \| string | 否 | — | A `Retry-After` longer than this skips retry and goes to fallback. Default 30000. |
| `ai.agent.providerResilience.requestTimeoutMs` | number \| string | 否 | — | Per-attempt timeout in ms (whole streamed completion). Default 180000. `0` disables. |
| `ai.agent.providerResilience.emptyReplyRetries` | number \| string | 否 | — | Extra attempts when the model returns neither text nor tool calls (or a tool call without a name). Default 0: the reply is passed through unchanged. Quirk presets (see model harness) raise this for models known to emit spurious empty replies. |
| `ai.agent.providerResilience.fallback` | boolean \| string | 否 | — | Try the next entry of `modelCandidates` after retries are exhausted. Default true. |
| `ai.agent.deferredTools` | object | 否 | — | 工具 schema 按需加载 |
| `ai.agent.deferredTools.maxLoadedPerSession` | number \| string | 否 | — | — |
| `ai.agent.deferredTools.discoverTopK` | number \| string | 否 | — | — |
| `ai.agent.deferredTools.alwaysLoadedTools` | array&lt;string&gt; | 否 | — | 额外常驻工具；默认在内置常驻集合基础上追加 |
| `ai.agent.deferredTools.alwaysLoadedMode` | string | 否 | — | `extend`（默认）追加到内置常驻集合；`replace` 完全替换 |
| `ai.agent.deferredTools.mcpServers` | object | 否 | — | — |
| `ai.agent.deferredTools.mcpServers.<key>.alwaysLoaded` | array&lt;string&gt; | 否 | — | — |
| `ai.agent.workerBaseTools` | array&lt;string&gt; | 否 | — | Deferred Worker 基础工具 |
| `ai.agent.persona` | string | 否 | — | — |
| `ai.agent.maxIterations` | number \| string | 否 | — | — |
| `ai.agent.timeout` | number \| string | 否 | — | — |
| `ai.agent.preExecTimeout` | number \| string | 否 | — | — |
| `ai.agent.maxTools` | number \| string | 否 | — | — |
| `ai.agent.contextTailMessageLimit` | number \| string | 否 | — | — |
| `ai.agent.rateLimit` | object | 否 | — | — |
| `ai.agent.rateLimit.maxRequestsPerMinute` | number \| string | 否 | — | 每分钟最大请求数（默认 20） |
| `ai.agent.rateLimit.cooldownSeconds` | number \| string | 否 | — | 冷却时间（秒），超限后需等待（默认 10） |
| `ai.agent.toneAwareness` | boolean \| string | 否 | — | — |
| `ai.agent.contextTokens` | number \| string | 否 | — | — |
| `ai.agent.maxHistoryShare` | number \| string | 否 | — | — |
| `ai.agent.compaction` | object | 否 | — | — |
| `ai.agent.compaction.enabled` | boolean \| string | 否 | — | — |
| `ai.agent.compaction.auto` | boolean \| string | 否 | — | — |
| `ai.agent.compaction.keepRecentTokens` | number \| string | 否 | — | — |
| `ai.agent.compaction.minKeepCount` | number \| string | 否 | — | — |
| `ai.agent.compaction.thresholdRatio` | number \| string | 否 | — | Share of the model context window (system prompt and tools included) at which auto-compaction runs. Default 0.7 (#730). |
| `ai.agent.disabledTools` | array&lt;string&gt; | 否 | — | — |
| `ai.agent.allowedTools` | array&lt;string&gt; | 否 | — | — |
| `ai.agent.maxParallelSubagents` | number \| string | 否 | — | — |
| `ai.agent.subagentAutoContinue` | boolean \| string | 否 | — | — |
| `ai.agent.subagentDirectImDelivery` | boolean \| string | 否 | — | — |
| `ai.agent.maxSubagentIterations` | number \| string | 否 | — | — |
| `ai.agent.subagentTools` | array&lt;string&gt; | 否 | — | — |
| `ai.agent.subagentTurnWaitMs` | number \| string | 否 | — | — |
| `ai.agent.skillInstructionMaxChars` | number \| string | 否 | — | — |
| `ai.agent.promptTrace` | boolean \| string | 否 | — | — |
| `ai.agent.promptTraceVerbose` | boolean \| string | 否 | — | — |
| `ai.agent.promptCache` | boolean \| string | 否 | — | — |
| `ai.agent.promptCacheKeyPrefix` | string | 否 | — | — |
| `ai.agent.deferredAutoContinue` | boolean \| string | 否 | — | — |
| `ai.agent.deferredAutoContinueMaxDepth` | number \| string | 否 | — | — |
| `ai.agent.gitStatus` | boolean \| string | 否 | — | §1 Runtime 注入单行 git 状态摘要（非 git 仓库自动跳过） |
| `ai.agent.contextPaths` | array&lt;string&gt; | 否 | — | 追加的上下文文件路径（支持 ~ 与相对路径；默认另加载 ~/.config/zhin/AGENTS.md 等全局路径） |
| `ai.agent.systemPromptMaxChars` | number \| string | 否 | — | 系统提示词总字符上限；按 retention/order 让出预算，required 内容放不下则失败。 |
| `ai.agent.thinkingPreview` | boolean \| string | 否 | — | Activity feedback 展示 LLM 实际 thinking 内容（截断），而非静态 "思考中..."。 |
| `ai.agent.thinkingPreviewMaxLength` | number \| string | 否 | — | thinkingPreview 展示的最大字符数。 |
| `ai.enabled` | boolean \| string | 否 | — | — |
| `ai.providers` | object \| null | 否 | — | 命名 provider 实例 |
| `ai.providers.<key>.sdk` | string | 否 | — | — |
| `ai.providers.<key>.apiKey` | string | 否 | — | — |
| `ai.providers.<key>.authScheme` | string | 否 | — | Authorization 头方案。不写时用各 SDK 默认（OpenAI 系 `Bearer`，Anthropic `x-api-key`，Google `x-goog-api-key`）； 设为 `''` 时 `Authorization: &lt;key&gt;`；设为 `'Bearer'` / `'Token'` 等时 `Authorization: &lt;scheme&gt; &lt;key&gt;`（结尾空格可有可无）。 |
| `ai.providers.<key>.baseUrl` | string | 否 | — | — |
| `ai.providers.<key>.defaultModel` | string | 否 | — | — |
| `ai.providers.<key>.models` | array&lt;string&gt; | 否 | — | — |
| `ai.providers.<key>.timeout` | number \| string | 否 | — | 单次请求超时（ms），覆盖 `ai.providerResilience.requestTimeoutMs`；模型 harness 的 `requestTimeoutMs` 优先。0 关闭。 |
| `ai.providers.<key>.maxRetries` | number \| string | 否 | — | 每个模型的重试次数，覆盖 `ai.providerResilience.maxRetries`。 |
| `ai.providers.<key>.firstChunkTimeoutMs` | number \| string | 否 | — | 流式请求首个 chunk 超时（ms，含等待响应头），默认关闭；超时按 timeout 重试 / 切换备用模型。 |
| `ai.providers.<key>.chunkTimeoutMs` | number \| string | 否 | — | 流式请求两个 chunk 之间的静默超时（ms），默认关闭。 |
| `ai.providers.<key>.headers` | object | 否 | — | — |
| `ai.providers.<key>.contextWindow` | number \| string | 否 | — | 上下文窗口大小（token 数），各 Provider 映射到自身参数 |
| `ai.providers.<key>.maxOutputTokens` | number \| string | 否 | — | 每次请求的输出 token 上限，默认 8192；Gemini/Claude 的思考 token 也计入 |
| `ai.providers.<key>.thinkingLevel` | string | 否 | — | 思考深度：`off` \| `low` \| `medium` \| `high`；不填用 provider 默认；`providerOptions` 里的思考设置优先 |
| `ai.providers.<key>.capabilities` | object | 否 | — | Provider 能力声明 |
| `ai.providers.<key>.capabilities.input` | array&lt;string&gt; | 否 | — | Explicit model input modalities. Absence is text-only (fail closed), except Gemini chat models on `sdk: google` (see `defaultModelInput`). |
| `ai.providers.<key>.capabilities.streaming` | boolean \| string | 否 | — | — |
| `ai.providers.<key>.capabilities.toolCalling` | boolean \| string | 否 | — | — |
| `ai.providers.<key>.capabilities.thinking` | boolean \| string | 否 | — | — |
| `ai.providers.<key>.input` | array&lt;string&gt; | 否 | — | Explicit model input modalities. Prefer this over inferred provider identity. |
| `ai.providers.<key>.providerOptions` | object | 否 | — | Extra AI SDK `providerOptions`, merged into every request of this provider, keyed by SDK provider id. For Gemini: `{ google: { safetySettings: [...], thinkingConfig: { thinkingLevel: 'low' } } }`. See ai.google.dev safety settings. |
| `ai.providers.<key>.contextCache` | object | 否 | — | Gemini context caching (`sdk: google`): `{ mode: 'explicit', ttlSeconds }`. Default implicit. |
| `ai.providers.<key>.contextCache.mode` | string | 否 | — | `implicit` (default) leaves requests untouched. `explicit` creates cachedContents. |
| `ai.providers.<key>.contextCache.ttlSeconds` | number \| string | 否 | — | Lifetime of each created cache. Default 600. |
| `ai.providers.<key>.contextCache.minPrefixChars` | number \| string | 否 | — | Prefixes shorter than this (characters of JSON) are not worth a cache. Default 8000 (~2k tokens). |
| `ai.providers.<key>.imageGeneration` | object | 否 | — | 文生图默认（zhipu / cloudflare 等支持 generateImage 的 driver） |
| `ai.providers.<key>.imageGeneration.watermarkEnabled` | boolean \| string | 否 | — | 智谱 API `watermark_enabled`；默认 true |
| `ai.providers.<key>.imageGeneration.defaultModel` | string | 否 | — | — |
| `ai.providers.<key>.imageGeneration.defaultSize` | string | 否 | — | 智谱：如 1024x1024、1280x1280 |
| `ai.providers.<key>.imageGeneration.numSteps` | number \| string | 否 | — | Cloudflare Flux：推理步数，默认 4 |
| `ai.providers.<key>.imageGeneration.quality` | string | 否 | — | OpenAI GPT Image：low \| medium \| high \| auto |
| `ai.providers.<key>.imageGeneration.aspectRatio` | string | 否 | — | Gemini：如 1:1、16:9 |
| `ai.providers.<key>.imageGeneration.imageSize` | string | 否 | — | Gemini：如 1K、2K、4K |
| `ai.providers.<key>.imageGeneration.promptSuffix` | string | 否 | — | 追加到 agent/用户 prompt 末尾的风格约束（如写实摄影）。 需要动漫风时不要配置，或在工具 prompt 里写明即可。 |
| `ai.providers.<key>.host` | string | 否 | — | — |
| `ai.providers.<key>.num_ctx` | number \| string | 否 | — | — |
| `ai.agents` | object \| null | 否 | — | per-agent 绑定（协作角色如 researcher 亦用 agents.&lt;role&gt;）；IM 入站总是交给 zhin |
| `ai.agents.<key>.provider` | string | 否 | — | — |
| `ai.agents.<key>.model` | string | 否 | — | — |
| `ai.agents.<key>.mcpServers` | array \| null | 否 | — | — |
| `ai.agents.<key>.nickname` | string | 否 | — | Agent 昵称（LLM 自称 + IM 协作展示，ADR 0024）。 |
| `ai.sessions` | object \| null | 否 | — | — |
| `ai.sessions.maxHistory` | number \| string | 否 | — | 最大历史消息数（数据库模式默认200，内存模式默认100） |
| `ai.sessions.expireMs` | number \| string | 否 | — | 会话过期时间（毫秒，数据库模式默认7天，内存模式默认24小时） |
| `ai.sessions.useDatabase` | boolean \| string | 否 | — | 是否使用数据库持久化存储（默认 true） |
| `ai.sessions.coldStartMaxMessages` | number \| string | 否 | — | 无摘要时冷启动最多条数（默认 50） |
| `ai.sessions.coldStartMaxAgeMs` | number \| string | 否 | — | 冷启动时间窗（毫秒，默认 24h） |
| `ai.sessions.sessionIdleArchiveMs` | number \| string | 否 | — | 空闲后自动归档 active 会话（毫秒，默认 7 天；0=关闭） |
| `ai.context` | object \| null | 否 | — | — |
| `ai.context.enabled` | boolean \| string | 否 | — | 是否启用消息记录（默认 true） |
| `ai.context.maxRecentMessages` | number \| string | 否 | — | 读取的最近消息数量（默认 100） |
| `ai.context.summaryThreshold` | number \| string | 否 | — | 触发总结的消息数量阈值（默认 50） |
| `ai.context.keepAfterSummary` | number \| string | 否 | — | 总结后保留的消息数量（默认 10） |
| `ai.context.maxContextTokens` | number \| string | 否 | — | 上下文最大 token 估算（默认 4000） |
| `ai.context.summaryPrompt` | string | 否 | — | 自定义总结提示词 |
| `ai.imageGeneration` | object \| null | 否 | — | 文生图全局默认（可被 `providers.&lt;alias&gt;.imageGeneration` 覆盖）。 智谱：`watermarkEnabled: false` 需先在智谱开放平台签署去水印免责声明。 |
| `ai.imageGeneration.watermarkEnabled` | boolean \| string | 否 | — | 智谱 API `watermark_enabled`；默认 true |
| `ai.imageGeneration.defaultModel` | string | 否 | — | — |
| `ai.imageGeneration.defaultSize` | string | 否 | — | 智谱：如 1024x1024、1280x1280 |
| `ai.imageGeneration.numSteps` | number \| string | 否 | — | Cloudflare Flux：推理步数，默认 4 |
| `ai.imageGeneration.quality` | string | 否 | — | OpenAI GPT Image：low \| medium \| high \| auto |
| `ai.imageGeneration.aspectRatio` | string | 否 | — | Gemini：如 1:1、16:9 |
| `ai.imageGeneration.imageSize` | string | 否 | — | Gemini：如 1K、2K、4K |
| `ai.imageGeneration.promptSuffix` | string | 否 | — | 追加到 agent/用户 prompt 末尾的风格约束（如写实摄影）。 需要动漫风时不要配置，或在工具 prompt 里写明即可。 |
| `ai.multimodal` | object \| null | 否 | — | 入站/出站多模态（base64 契约；平台 adapter 负责编解码与发送） |
| `ai.multimodal.enabled` | boolean \| string | 否 | — | — |
| `ai.multimodal.maxFileBytes` | number \| string | 否 | — | — |
| `ai.multimodal.inboundDir` | string | 否 | — | — |
| `ai.multimodal.outboundDir` | string | 否 | — | — |
| `ai.multimodal.image` | object | 否 | — | — |
| `ai.multimodal.image.maxDimension` | number \| string | 否 | — | — |
| `ai.multimodal.image.preferNativeVision` | boolean \| string | 否 | — | — |
| `ai.multimodal.audio` | object | 否 | — | — |
| `ai.multimodal.audio.strategy` | string | 否 | — | — |
| `ai.multimodal.video` | object | 否 | — | — |
| `ai.multimodal.video.strategy` | string | 否 | — | — |
| `ai.multimodal.video.mcpServer` | string | 否 | — | — |
| `ai.multimodal.video.maxFrames` | number \| string | 否 | — | — |
| `ai.multimodal.outbound` | object | 否 | — | — |
| `ai.multimodal.outbound.splitMessages` | string | 否 | — | — |
| `ai.multimodal.perception` | object \| null | 否 | — | Perception pre-pass: when the turn's model cannot take an image / video / PDF, this media-capable model describes it and the description is injected as untrusted text (`[图片描述] …`). Unset = off (placeholders as before). |
| `ai.multimodal.perception.provider` | string | 否 | — | `ai.providers` alias of the perception model. |
| `ai.multimodal.perception.model` | string | 否 | — | — |
| `ai.multimodal.perception.kinds` | array&lt;string&gt; | 否 | — | Kinds to describe. Default `['image']`; `file` covers PDFs only. |
| `ai.multimodal.perception.maxChars` | number \| string | 否 | — | Description length cap in characters. Default 800. |
| `ai.multimodal.perception.timeoutMs` | number \| string | 否 | — | Per-attempt timeout in ms. Default 30000. |
| `ai.multimodal.perception.maxItemsPerTurn` | number \| string | 否 | — | Media described per turn; the rest keep the placeholder. Default 4. |
| `ai.multimodal.perception.fallbacks` | array&lt;object&gt; | 否 | — | 主识图模型失败、空回答或不支持该媒体时，按顺序尝试；不改变主对话模型。 |
| `ai.multimodal.perception.fallbacks[].provider` | string | 是 | — | — |
| `ai.multimodal.perception.fallbacks[].model` | string | 是 | — | — |
| `ai.memory` | object \| null | 否 | — | 三层 Markdown 文件记忆（global / platform / session）。 默认启用；设 enabled: false 可关闭注入。 |
| `ai.memory.enabled` | boolean \| string | 否 | — | — |
| `ai.memory.semantic` | object \| null | 否 | — | L4 语义记忆：memory_entries 表 + memory_search/upsert 工具 |
| `ai.memory.semantic.enabled` | boolean \| string | 否 | — | — |
| `ai.memory.semantic.autoConsolidate` | boolean \| string | 否 | — | — |
| `ai.memory.semantic.recall` | object \| null | 否 | — | Per-turn recall (#734): BM25 top-k entries relevant to the current message are added to the turn context. Default on when semantic memory is enabled; topK 5, maxTokens 400. |
| `ai.memory.semantic.recall.enabled` | boolean \| string | 否 | — | — |
| `ai.memory.semantic.recall.topK` | number \| string \| null | 否 | — | — |
| `ai.memory.semantic.recall.maxTokens` | number \| string \| null | 否 | — | — |
| `ai.memory.budgets` | object | 否 | — | — |
| `ai.memory.budgets.session` | number \| string | 否 | — | — |
| `ai.memory.budgets.platform` | number \| string | 否 | — | — |
| `ai.memory.budgets.global` | number \| string | 否 | — | — |
| `ai.memory.budgets.daily` | number \| string | 否 | — | — |
| `ai.knowledge` | object | 否 | — | 本地知识库（knowledge_search 工具数据源）。 放置 .md / .txt 文件到 baseDir，Agent 可通过 knowledge_search 工具检索。 |
| `ai.knowledge.baseDir` | string | 否 | — | 项目根目录内的知识库目录路径。配置该段时必须显式声明。 |
| `ai.githubMcp` | object | 否 | — | PAT for adapter-github auto-registered server-github MCP (overrides env when set). |
| `ai.githubMcp.token` | string | 否 | — | — |
| `ai.githubMcp.enabled` | boolean \| string | 否 | — | 为 true 时注册 server-github MCP（PAT，人身份）；默认 false，Bot 写操作用 adapter github_* 工具 |
| `ai.mcpServers` | array \| null | 否 | — | External MCP servers for the Agent MCP client (global, all bots). Listed servers are exposed to ZhinAgent tool pool when connected. |
| `ai.access` | object \| null | 否 | — | AI 访问控制（平台 AIGC 合规；Endpoint 可用 aiAccess 覆盖） |
| `ai.access.mode` | string | 否 | — | open \| closed \| whitelist，默认 open |
| `ai.access.users` | array&lt;string&gt; | 否 | — | 允许触发 AI 的 sender.id |
| `ai.access.groups` | array&lt;string&gt; | 否 | — | 允许触发 AI 的 group/channel id |
| `ai.access.denyMessage` | string | 否 | — | 私聊拒绝时的回复文案 |
| `ai.trigger` | object \| null | 否 | — | AI 触发配置 |
| `ai.trigger.enabled` | boolean \| string | 否 | — | 是否启用（默认 true） |
| `ai.trigger.prefixes` | array&lt;string&gt; | 否 | — | 触发前缀列表（默认 ['#', 'AI:']） |
| `ai.trigger.respondToAt` | boolean \| string | 否 | — | 是否响应 @ 机器人（默认 true） |
| `ai.trigger.respondToPrivate` | boolean \| string | 否 | — | 是否响应私聊（默认 true） |
| `ai.trigger.keywords` | array&lt;string&gt; | 否 | — | 触发关键词（可选） |
| `ai.trigger.ignorePrefixes` | array&lt;string&gt; | 否 | — | 忽略的前缀（命令前缀，避免与命令冲突，默认 ['/', '!', '！']） |
| `ai.trigger.timeout` | number \| string | 否 | — | 超时时间（毫秒，默认 60000） |
| `ai.trigger.thinkingMessage` | string | 否 | — | 思考中提示语（可选，设置后会在处理前发送） |
| `ai.trigger.errorTemplate` | string | 否 | — | 入口层错误提示模板，{error} 为错误信息（可选；不配置时用聊天口吻说"刚卡了一下"，主人额外看到原因） |
| `ai.trigger.ambient` | object | 否 | — | 群聊旁听：群里没人叫机器人时，由判断模型决定是否接话。被 @、引用和私聊不经过这里，总会交给 Agent（Agent 也可以选择不回复）。 |
| `ai.trigger.ambient.conversations` | array&lt;string&gt; | 否 | — | 开启旁听的群，格式 platform:groupId；* 表示所有群。默认为空（关闭） |
| `ai.trigger.ambient.judge` | string \| array | 否 | — | 判断模型 providerAlias/model；也可以写成列表，前一个失败或限流时按顺序换下一个（免费额度通常按模型分别计算）。默认用主 Agent 的模型 |
| `ai.trigger.ambient.quietMs` | number \| string | 否 | — | 群安静多久后才判断一次（毫秒，默认 4000） |
| `ai.trigger.ambient.cooldownMs` | number \| string | 否 | — | 两次主动插话之间的最短间隔（毫秒，默认 120000）；对话进行中不受限制 |
| `ai.trigger.ambient.maxPerHour` | number \| string | 否 | — | 每个群每小时最多主动插话次数（默认 3）；对话进行中不计入 |
| `ai.trigger.ambient.conversationWindowMs` | number \| string | 否 | — | 机器人说话后，这段时间内算作对话进行中：群友接它的话只由判断模型决定，不受冷却和每小时次数限制（毫秒，默认 180000） |
| `ai.trigger.ambient.judgeIntervalMs` | number \| string | 否 | — | 没在对话时，同一个群至少隔这么久才判断一次（毫秒，默认 30000），节省判断模型的额度 |
| `ai.trigger.ambient.minConfidence` | number \| string | 否 | — | 判断模型置信度门槛 0..1（默认 0.7） |
| `ai.trigger.ambient.mode` | string: `"active"`, `"shadow"` | 否 | — | shadow 只记录判断结果、不回复（默认 active） |
| `menuKeyword` | string \| `false` | 否 | — | 内置指令菜单关键词；默认 菜单，false 或空字符串关闭菜单。 |
| `menuStyle` | object | 否 | — | HTML 渲染可用时的指令菜单外观；始终保留纯文本降级。 |
| `menuStyle.title` | string | 否 | — | 菜单标题。 |
| `menuStyle.subtitle` | string | 否 | — | 菜单副标题。 |
| `menuStyle.accentColor` | string | 否 | — | 六位十六进制强调色；无效值使用渲染器默认值。 |
| `menuStyle.backgroundImage` | string | 否 | — | HTTP(S) 图片或 PNG/JPEG/WebP data URL；不支持的值使用渲染器默认值。 |
| `mcp` | object | 否 | — | 把 Bot 工具公开为 MCP Server。 |
| `mcp.enabled` | boolean \| string | 否 | — | — |
| `mcp.path` | string \| null | 否 | — | — |
| `mcp.token` | string \| null | 否 | — | — |
| `mcp.allowUnauthenticatedLocalhost` | boolean \| string | 否 | — | — |
| `a2a` | object | 否 | — | A2A Agent Card、远程执行与 Workroom 回调。 |
| `a2a.enabled` | boolean \| string | 否 | — | — |
| `a2a.path` | string \| null | 否 | — | — |
| `a2a.token` | string \| null | 否 | — | — |
| `a2a.publicUrl` | string \| null | 否 | — | — |
| `a2a.workroomCallbacks` | object \| null | 否 | — | — |
| `a2a.workroomCallbacks.enabled` | boolean \| string | 否 | — | — |
| `a2a.workroomCallbacks.path` | string | 否 | — | Must remain outside the ordinary `/a2a/{agent}/*` route tree. |
| `a2a.workroomCallbacks.maxBodyBytes` | number \| string | 否 | — | — |
| `a2a.workroomCallbacks.maxSequenceGap` | number \| string | 否 | — | — |
| `a2a.workroomCallbacks.bindings` | array&lt;object&gt; | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].endpointId` | string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].tenantId` | string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].cardDigest` | string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].authBindingId` | string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].trustDomain` | string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].extensionDigest` | string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].credentialId` | string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].credential` | object \| object | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].enabled` | boolean \| string | 否 | — | — |
| `a2a.workroomCallbacks.bindings[].expiresAt` | number \| string | 否 | — | — |
| `a2a.workroomRemoteExecutors` | object \| null | 否 | — | Transport endpoints only. Project/Workroom topology remains in the persistent Catalog. |
| `a2a.workroomRemoteExecutors.enabled` | boolean \| string | 否 | — | — |
| `a2a.workroomRemoteExecutors.maxResponseBytes` | number \| string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings` | array&lt;object&gt; | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].endpointId` | string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].cardDigest` | string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authBindingId` | string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].dispatchUrl` | string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].pollUrl` | string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].credential` | object \| object | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority` | object | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.workroomExtension` | `"https://zhin.dev/extensions/workroom-executor/v1"` \| string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.idempotentDispatch` | boolean \| string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.typedCompletionEnvelope` | boolean \| string | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].authority.workspaceProviders` | array&lt;string&gt; | 否 | — | — |
| `a2a.workroomRemoteExecutors.bindings[].enabled` | boolean \| string | 否 | — | — |
| `speech` | object | 否 | — | 语音识别与语音合成 Host。 |
| `speech.stt` | object \| null | 否 | — | — |
| `speech.stt.enabled` | boolean \| string | 否 | — | — |
| `speech.stt.provider` | string | 否 | — | — |
| `speech.stt.model` | string | 否 | — | — |
| `speech.stt.host` | string | 否 | — | — |
| `speech.stt.apiKey` | string | 否 | — | — |
| `speech.tts` | object \| null | 否 | — | — |
| `speech.tts.enabled` | boolean \| string | 否 | — | — |
| `speech.tts.provider` | string | 否 | — | — |
| `speech.tts.voice` | string | 否 | — | — |
| `speech.tts.model` | string | 否 | — | — |
| `speech.tts.host` | string | 否 | — | — |
| `speech.tts.apiKey` | string | 否 | — | — |
| `speech.tts.rate` | string | 否 | — | edge-tts |
| `speech.tts.pitch` | string | 否 | — | — |
| `speech.tts.edgeTtsCommand` | string | 否 | — | — |
| `speech.tts.region` | string | 否 | — | azure |
| `speech.tts.subscriptionKey` | string | 否 | — | — |
| `speech.tts.baseUrl` | string | 否 | — | custom OpenAI-compatible |
| `speech.tts.headers` | object | 否 | — | — |
| `speech.tts.speed` | number \| string | 否 | — | — |
| `htmlRenderer` | object | 否 | — | 基于 Shotium 的 HTML/图片渲染参数。 |
| `htmlRenderer.width` | number | 否 | — | 默认排版宽度（CSS 像素）。 |
| `htmlRenderer.defaultWidth` | number | 否 | — | width 的旧别名。 |
| `htmlRenderer.viewport` | object | 否 | — | Shotium 渲染默认视窗。 |
| `htmlRenderer.viewport.width` | number | 否 | — | 视窗宽度（CSS 像素）。 |
| `htmlRenderer.viewport.height` | number | 否 | — | 视窗高度（CSS 像素）。 |
| `htmlRenderer.backgroundColor` | string | 否 | — | HTML 片段背景色。 |
| `htmlRenderer.defaultBackgroundColor` | string | 否 | — | backgroundColor 的旧别名。 |
| `htmlRenderer.scale` | number | 否 | — | 设备像素比。 |
| `htmlRenderer.type` | string: `"png"`, `"jpeg"`, `"webp"` | 否 | — | 默认位图输出格式。 |
| `htmlRenderer.quality` | number | 否 | — | jpeg/webp 输出质量。 |
| `htmlRenderer.timeout` | number | 否 | — | 导航超时（毫秒）。 |
| `htmlRenderer.waitUntil` | string: `"load"`, `"networkidle"` | 否 | — | 导航等待策略。 |
| `htmlRenderer.fontFamily` | string | 否 | — | HTML 片段默认字体栈。 |
| `htmlRenderer.maxImageHeight` | number | 否 | — | 超过该高度时切分 PNG；0 表示不切分。 |
| `htmlRenderer.sliceCompression` | number | 否 | — | PNG 切片时使用的压缩级别。 |
| `htmlRenderer.allowFileAccess` | boolean | 否 | — | 允许访问本地文件子资源。 |
| `htmlRenderer.takeOverHtmlSegments` | boolean | 否 | — | 接管 html/markdown 富媒体段转图。 |
| `htmlRenderer.cacheDir` | string | 否 | — | HTTP 缓存目录；off 表示关闭。 |
| `htmlRenderer.cacheMaxBytes` | number | 否 | — | HTTP 缓存最大字节数。 |
| `htmlRenderer.userAgent` | string | 否 | — | 自定义 User-Agent。 |
| `htmlRenderer.idleTimeoutMs` | number | 否 | — | daemon 空闲退出超时（毫秒）。 |
| `htmlRenderer.logStats` | boolean | 否 | — | 记录渲染耗时统计。 |
| `htmlRenderer.mode` | string: `"inprocess"`, `"daemon"` | 否 | — | Shotium 在进程内运行还是以 daemon 运行。 |
| `htmlRenderer.aiTextAsImage` | boolean \| object | 否 | — | 发送前可选的纯文本转图片。 |
| `assistant` | object | 否 | — | 调度任务、事件入口和失败通知。 |
| `assistant.enabled` | boolean \| string | 否 | — | 启用统一 JobStore（默认 false，Stable 行为不变） |
| `assistant.queue` | object \| null | 否 | — | Schedule execution queue（重试 / 并发 / 死信） |
| `assistant.queue.maxConcurrency` | number \| string \| null | 否 | — | Schedule execution 并发上限 |
| `assistant.queue.maxRetries` | number \| string \| null | 否 | — | — |
| `assistant.queue.defaultTimeoutMs` | number \| string \| null | 否 | — | — |
| `assistant.defaults` | object \| null | 否 | — | — |
| `assistant.defaults.notify` | object \| object \| object \| object \| null | 否 | — | 未显式指定 notify 时的默认投递目标（M3） |
| `assistant.defaults.notifyOnFailure` | boolean \| string | 否 | — | Job 失败时是否通知（默认 false） |
| `assistant.profile` | object \| null | 否 | — | — |
| `assistant.profile.enabled` | boolean \| string | 否 | — | 启用 Profile 覆盖 Bootstrap（默认 false） |
| `assistant.profile.file` | string \| null | 否 | — | 相对项目根路径，默认 assistant.profile.yml |
| `assistant.home` | object \| null | 否 | — | — |
| `assistant.home.enabled` | boolean \| string | 否 | — | — |
| `assistant.home.restUrl` | string | 否 | — | HA REST 基址，如 http://homeassistant.local:8123 |
| `assistant.home.restToken` | string | 否 | — | HA 长期访问令牌 |
| `assistant.home.mcpServer` | string | 否 | — | 可选：ai.mcpServers 中的名称（REST 为主，MCP 仅校验） |
| `assistant.home.aliases` | object \| null | 否 | — | 中文/友好名 → entity_id |
| `assistant.home.policy` | object \| null | 否 | — | — |
| `assistant.home.policy.requireMaster` | boolean \| string | 否 | — | 仅 master 可调用 home_*（默认 true） |
| `assistant.home.policy.confirmServices` | array \| null | 否 | — | 写操作需 Owner 审批的 HA domain（默认 lock、alarm_control_panel） |
| `assistant.home.policy.allowedServiceDomains` | array \| null | 否 | — | home_call_service 允许的 domain 白名单（默认 light/climate/scene/cover/script） |
| `assistant.home.watch` | array \| null | 否 | — | 要通过 HA WebSocket 订阅状态变化的设备别名列表 |
| `assistant.home.debounceMs` | number \| string \| null | 否 | — | 同实体状态变化推送的防抖间隔（毫秒，默认 5000） |
| `assistant.events` | object \| null | 否 | — | — |
| `assistant.events.enabled` | boolean \| string | 否 | — | 启用 POST /api/assistant/events（需 assistant.enabled） |
| `assistant.events.token` | string | 否 | — | 可选专用 Bearer；未设时复用 http.token（路由仍在 /api 下受全局鉴权保护）。 |
| `assistant.events.allowedSources` | array&lt;string&gt; | 否 | — | 允许的来源白名单；空数组表示不限制 |
| `assistant.events.rateLimitPerMinute` | number \| string \| null | 否 | — | 每来源每分钟最大请求数（默认 60） |
| `log_level` | string \| number | 否 | — | Runtime 日志级别。 |
| `plugin` | object | 否 | — | Root Plugin 配置；组合时由项目 Schema 替换。 |

## 插件实例字段

以下字段通过 Runtime 的统一读取器从 trusted 插件的 `config: Schema.object(...)` 声明或 `schema.json` 生成；isolated 插件只能使用 `schema.json`。顶层 `<name>` 是默认 instanceKey；`plugins.<name>` 仅保存包引用。

### dingtalk

[`plugins/adapters/dingtalk/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/dingtalk/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `dingtalk.apiBaseUrl` | string | 否 | `"https://oapi.dingtalk.com"` | — |
| `dingtalk.master` | string \| number | 否 | — | 框架 master（DingTalk userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `dingtalk.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `dingtalk.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `dingtalk.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（DingTalk userid）；覆盖顶层 master |
| `dingtalk.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `dingtalk.endpoints[].appKey` | string | 是 | — | Dingtalk app key |
| `dingtalk.endpoints[].appSecret` | string | 是 | — | Dingtalk app secret |
| `dingtalk.endpoints[].webhookPath` | string | 否 | — | Dingtalk webhook path |
| `dingtalk.endpoints[].robotCode` | string | 否 | — | Dingtalk robot code |
| `dingtalk.endpoints[].apiBaseUrl` | string | 否 | — | — |
| `dingtalk.endpoints[].commandPrefix` | string | 否 | — | — |
| `dingtalk.endpoints[].id` | string | 是 | — | Dingtalk bot name |
| `dingtalk.endpoints[].mode` | string: `"webhook"`, `"stream"` | 否 | `"webhook"` | — |
| `dingtalk.endpoints[].cardTemplateId` | string | 否 | — | Stream interactive card template ID |
| `dingtalk.endpoints[].cardButtonCount` | integer | 否 | `2` | Fixed button count in the card template |
| `dingtalk.endpoints[].streamProxy` | object | 否 | — | 故障验收专用：TCP固定127.0.0.1，保留真实WSS TLS身份 |
| `dingtalk.endpoints[].streamProxy.port` | integer | 是 | — | — |
| `dingtalk.endpoints[].streamProxy.serverName` | string | 是 | — | — |
| `dingtalk.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `dingtalk.mode` | string: `"webhook"`, `"stream"` | 否 | `"webhook"` | — |
| `dingtalk.cardTemplateId` | string | 否 | — | Stream interactive card template ID |
| `dingtalk.cardButtonCount` | integer | 否 | `2` | Fixed button count in the card template |

### discord

[`plugins/adapters/discord/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/discord/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `discord.connection` | string: `"gateway"`, `"interactions"` | 否 | `"gateway"` | Gateway WebSocket (default). interactions uses httpHostToken POST + Ed25519 verify. |
| `discord.intents` | array&lt;number&gt; | 否 | — | — |
| `discord.enableSlashCommands` | boolean | 否 | `false` | — |
| `discord.globalCommands` | boolean | 否 | `false` | — |
| `discord.defaultActivity` | object | 否 | — | — |
| `discord.defaultActivity.name` | string | 是 | — | — |
| `discord.defaultActivity.type` | string: `"PLAYING"`, `"STREAMING"`, `"LISTENING"`, `"WATCHING"`, `"COMPETING"` | 是 | — | — |
| `discord.defaultActivity.url` | string | 否 | — | — |
| `discord.slashCommands` | array&lt;object&gt; | 否 | — | — |
| `discord.applicationId` | string | 否 | — | Required when connection is interactions. |
| `discord.publicKey` | string | 否 | — | Required when connection is interactions (hex Ed25519 public key). |
| `discord.interactionsPath` | string | 否 | `"/discord/interactions"` | POST path on httpHostToken when connection is interactions. |
| `discord.master` | string \| number | 否 | — | 框架 master（Discord user snowflake；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `discord.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `discord.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项定义一个 endpoint，id/token 必填，其余字段覆盖实例默认值 |
| `discord.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Discord user snowflake）；覆盖顶层 master |
| `discord.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `discord.endpoints[].token` | string | 是 | — | Discord bot token |
| `discord.endpoints[].connection` | string: `"gateway"`, `"interactions"` | 否 | — | — |
| `discord.endpoints[].intents` | array&lt;number&gt; | 否 | — | — |
| `discord.endpoints[].enableSlashCommands` | boolean | 否 | — | — |
| `discord.endpoints[].globalCommands` | boolean | 否 | — | — |
| `discord.endpoints[].defaultActivity` | object | 否 | — | — |
| `discord.endpoints[].defaultActivity.name` | string | 是 | — | — |
| `discord.endpoints[].defaultActivity.type` | string: `"PLAYING"`, `"STREAMING"`, `"LISTENING"`, `"WATCHING"`, `"COMPETING"` | 是 | — | — |
| `discord.endpoints[].defaultActivity.url` | string | 否 | — | — |
| `discord.endpoints[].slashCommands` | array&lt;object&gt; | 否 | — | — |
| `discord.endpoints[].applicationId` | string | 否 | — | — |
| `discord.endpoints[].publicKey` | string | 否 | — | — |
| `discord.endpoints[].interactionsPath` | string | 否 | — | — |
| `discord.endpoints[].commandPrefix` | string | 否 | — | — |
| `discord.endpoints[].id` | string | 是 | — | Discord bot name |
| `discord.endpoints[].gatewayFaultProxyUrl` | string | 否 | — | Isolated acceptance only: loopback Gateway fault proxy; REST unchanged. |
| `discord.endpoints[].restApiProxy` | object | 否 | — | Gateway测试实例REST专用故障代理：discord.com:443固定loopback TCP，保留SNI/证书校验，独立于Gateway代理 |
| `discord.endpoints[].restApiProxy.port` | integer | 是 | — | — |
| `discord.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `discord.gatewayFaultProxyUrl` | string | 否 | — | Isolated acceptance only: loopback Gateway fault proxy; REST unchanged. |

### email

[`plugins/adapters/email/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/email/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `email.master` | string \| number | 否 | — | 框架 master（email address；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `email.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `email.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `email.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（email address）；覆盖顶层 master |
| `email.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `email.endpoints[].smtp` | object | 是 | — | — |
| `email.endpoints[].smtp.host` | string | 是 | — | — |
| `email.endpoints[].smtp.port` | number | 是 | — | — |
| `email.endpoints[].smtp.secure` | boolean | 是 | — | — |
| `email.endpoints[].smtp.auth` | object | 是 | — | — |
| `email.endpoints[].smtp.auth.user` | string | 是 | — | — |
| `email.endpoints[].smtp.auth.pass` | string | 是 | — | — |
| `email.endpoints[].smtp.serverName` | string | 否 | — | TLS SNI 与证书主机名校验，代理场景保留原服务域名；不改变证书校验策略 |
| `email.endpoints[].imap` | object | 是 | — | — |
| `email.endpoints[].imap.host` | string | 是 | — | — |
| `email.endpoints[].imap.port` | number | 是 | — | — |
| `email.endpoints[].imap.tls` | boolean | 是 | — | — |
| `email.endpoints[].imap.user` | string | 是 | — | — |
| `email.endpoints[].imap.password` | string | 是 | — | — |
| `email.endpoints[].imap.checkInterval` | number | 否 | `60000` | — |
| `email.endpoints[].imap.reconnectInterval` | number | 否 | `5000` | — |
| `email.endpoints[].imap.mailbox` | string | 否 | `"INBOX"` | — |
| `email.endpoints[].imap.markSeen` | boolean | 否 | `true` | — |
| `email.endpoints[].imap.serverName` | string | 否 | — | TLS SNI 与证书主机名校验，代理场景保留原服务域名；不改变证书校验策略 |
| `email.endpoints[].attachments` | object | 否 | — | — |
| `email.endpoints[].attachments.enabled` | boolean | 否 | `false` | — |
| `email.endpoints[].attachments.downloadPath` | string | 否 | — | — |
| `email.endpoints[].attachments.maxFileSize` | number | 否 | — | — |
| `email.endpoints[].attachments.allowedTypes` | array&lt;string&gt; | 否 | — | — |
| `email.endpoints[].commandPrefix` | string | 否 | — | — |
| `email.endpoints[].id` | string | 是 | — | Email bot name |
| `email.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### github

[`plugins/adapters/github/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/github/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `github.host` | string | 否 | — | GitHub Enterprise hostname (default github.com) |
| `github.webhook_path` | string | 否 | `"/github/webhook"` | — |
| `github.auto_reply_repos` | array&lt;string&gt; | 否 | — | Repos whose Issue/PR comments auto-trigger AI without @bot |
| `github.bot_login` | string | 否 | — | Override App bot login (default {slug}[bot]) |
| `github.workspace_root` | string | 否 | — | Managed git workspace root |
| `github.master` | string \| number | 否 | — | 框架 master（GitHub user login or id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `github.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `github.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint |
| `github.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（GitHub user login or id）；覆盖顶层 master |
| `github.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `github.endpoints[].app_id` | string \| number | 是 | — | GitHub App ID |
| `github.endpoints[].private_key` | string | 是 | — | GitHub App private key (PEM content or file path) |
| `github.endpoints[].webhook_secret` | string | 否 | — | Webhook HMAC secret; enables httpHostToken POST route |
| `github.endpoints[].id` | string | 是 | — | GitHub App bot name |
| `github.endpoints[].host` | string | 否 | — | GitHub Enterprise hostname |
| `github.endpoints[].webhook_path` | string | 否 | — | Webhook route path |
| `github.endpoints[].auto_reply_repos` | array&lt;string&gt; | 否 | — | Repos whose comments auto-trigger AI |
| `github.endpoints[].bot_login` | string | 否 | — | Override App bot login |
| `github.endpoints[].workspace_root` | string | 否 | — | Managed git workspace root |
| `github.endpoints[].commandPrefix` | string | 否 | — | 本 endpoint 的命令前缀 |
| `github.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### icqq

[`plugins/adapters/icqq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/icqq/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `icqq.master` | string \| number | 是 | — | 框架 master QQ uin（/approve、AI/工具权限）；endpoints[i].master 可逐项覆盖 |
| `icqq.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted QQ uin 列表（弱于 master） |
| `icqq.password` | string | 否 | — | QQ 密码（可选，不填则扫码登录） |
| `icqq.platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | 否 | `1` | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `icqq.ver` | string | 否 | — | 协议版本号，仅在对应 platform 有多个版本时有效，不填则使用最新版本 |
| `icqq.signApiAddr` | string | 否 | — | 签名服务器地址；未配置时若安装了 @icqqjs/qqsign 则自动使用本地签名 |
| `icqq.dataDir` | string | 否 | — | 数据存储文件夹路径，默认为主模块下的 data 文件夹 |
| `icqq.autoReconnect` | boolean | 否 | `true` | 断线后是否自动重连（默认 true） |
| `icqq.outboundMedia` | string: `"file"`, `"base64"` | 否 | `"file"` | 出站媒体模式：file=落盘本地路径（默认）; base64=CQ base64:// 内联 |
| `icqq.ignoreSelf` | boolean | 否 | `true` | 群聊和频道中是否过滤自己的消息（默认 true） |
| `icqq.resend` | boolean | 否 | `false` | 被风控时是否尝试用分片发送（默认 false） |
| `icqq.cacheGroupMember` | boolean | 否 | `true` | 是否缓存群员列表（默认 true）；群多时（500+）会多占约 100MB+ 内存 |
| `icqq.autoServer` | boolean | 否 | `true` | 是否自动选择最优服务器（默认 true） |
| `icqq.qqnt` | boolean | 否 | `true` | 是否使用 QQNT 协议（默认 true） |
| `icqq.ntLogin` | boolean | 否 | — | 是否使用 NT 登录方式 |
| `icqq.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `icqq.endpoints[].id` | string | 是 | — | QQ uin |
| `icqq.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的 master QQ uin；覆盖顶层 master |
| `icqq.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `icqq.endpoints[].password` | string | 否 | — | 本 endpoint 的 QQ 密码 |
| `icqq.endpoints[].platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | 否 | — | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `icqq.endpoints[].ver` | string | 否 | — | 协议版本号 |
| `icqq.endpoints[].signApiAddr` | string | 否 | — | 签名服务器地址 |
| `icqq.endpoints[].dataDir` | string | 否 | — | 数据存储文件夹路径 |
| `icqq.endpoints[].autoReconnect` | boolean | 否 | — | 断线后是否自动重连 |
| `icqq.endpoints[].outboundMedia` | string: `"file"`, `"base64"` | 否 | — | 出站媒体模式 |
| `icqq.endpoints[].ignoreSelf` | boolean | 否 | — | 是否过滤自己的消息 |
| `icqq.endpoints[].resend` | boolean | 否 | — | 被风控时是否分片发送 |
| `icqq.endpoints[].cacheGroupMember` | boolean | 否 | — | 是否缓存群员列表 |
| `icqq.endpoints[].autoServer` | boolean | 否 | — | 是否自动选择最优服务器 |
| `icqq.endpoints[].qqnt` | boolean | 否 | — | 是否使用 QQNT 协议 |
| `icqq.endpoints[].ntLogin` | boolean | 否 | — | 是否使用 NT 登录方式 |
| `icqq.endpoints[].commandPrefix` | string | 否 | — | 本 endpoint 的命令前缀 |
| `icqq.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀）。endpoints[i] 可逐项覆盖 |

### kook

[`plugins/adapters/kook/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/kook/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `kook.connection` | string: `"websocket"`, `"webhook"` | 否 | `"websocket"` | WebSocket gateway (default). webhook requires httpHostToken, verify_token, and a public HTTPS callback URL. |
| `kook.webhookPath` | string | 否 | `"/kook/webhook"` | POST path registered via httpHostToken when connection is webhook. |
| `kook.data_dir` | string | 否 | — | — |
| `kook.timeout` | number | 否 | `10000` | — |
| `kook.max_retry` | number | 否 | `3` | — |
| `kook.ignore` | string: `"bot"`, `"self"` | 否 | `"bot"` | — |
| `kook.logLevel` | string: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`, `"mark"`, `"off"` | 否 | `"info"` | — |
| `kook.master` | string \| number | 否 | — | 框架 master（KOOK user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `kook.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `kook.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项定义一个 endpoint，id/token 必填，其余字段覆盖实例默认值 |
| `kook.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（KOOK user id）；覆盖顶层 master |
| `kook.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `kook.endpoints[].token` | string | 是 | — | KOOK bot token |
| `kook.endpoints[].connection` | string: `"websocket"`, `"webhook"` | 否 | — | — |
| `kook.endpoints[].webhookPath` | string | 否 | — | — |
| `kook.endpoints[].verify_token` | string | 否 | — | KOOK developer console verify token (required for webhook mode). |
| `kook.endpoints[].encrypt_key` | string | 否 | — | Optional Encrypt Key when message encryption is enabled in KOOK console. |
| `kook.endpoints[].data_dir` | string | 否 | — | — |
| `kook.endpoints[].timeout` | number | 否 | — | — |
| `kook.endpoints[].max_retry` | number | 否 | — | — |
| `kook.endpoints[].ignore` | string: `"bot"`, `"self"` | 否 | — | — |
| `kook.endpoints[].logLevel` | string: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`, `"mark"`, `"off"` | 否 | — | — |
| `kook.endpoints[].commandPrefix` | string | 否 | — | — |
| `kook.endpoints[].id` | string | 是 | — | KOOK bot name |
| `kook.endpoints[].streamProxy` | object | 否 | — | WSS故障验收固定loopback，保持真实TLS身份 |
| `kook.endpoints[].streamProxy.port` | integer | 是 | — | — |
| `kook.endpoints[].streamProxy.serverName` | string | 是 | — | — |
| `kook.endpoints[].apiProxy` | object | 否 | — | Optional fixed loopback TCP route for www.kookapp.cn JSON API only; verified TLS remains enabled. |
| `kook.endpoints[].apiProxy.port` | integer | 是 | — | — |
| `kook.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### lark

[`plugins/adapters/lark/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/lark/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `lark.webhookPath` | string | 否 | `"/lark/webhook"` | — |
| `lark.apiBaseUrl` | string | 否 | — | — |
| `lark.isFeishu` | boolean | 否 | `true` | — |
| `lark.master` | string \| number | 否 | — | 框架 master（Lark/Feishu open_id or user_id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `lark.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `lark.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `lark.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Lark/Feishu open_id or user_id）；覆盖顶层 master |
| `lark.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `lark.endpoints[].appId` | string | 是 | — | Lark app ID |
| `lark.endpoints[].appSecret` | string | 是 | — | Lark app secret |
| `lark.endpoints[].encryptKey` | string | 否 | — | Lark encrypt key |
| `lark.endpoints[].verificationToken` | string | 否 | — | Lark verification token |
| `lark.endpoints[].webhookPath` | string | 否 | — | — |
| `lark.endpoints[].apiBaseUrl` | string | 否 | — | — |
| `lark.endpoints[].isFeishu` | boolean | 否 | — | — |
| `lark.endpoints[].commandPrefix` | string | 否 | — | — |
| `lark.endpoints[].id` | string | 是 | — | Lark bot name |
| `lark.endpoints[].mode` | string: `"webhook"`, `"websocket"` | 否 | `"webhook"` | — |
| `lark.endpoints[].streamProxy` | object | 否 | — | WSS故障验收：仅TCP固定loopback，保留TLS身份 |
| `lark.endpoints[].streamProxy.port` | integer | 是 | — | — |
| `lark.endpoints[].streamProxy.serverName` | string | 是 | — | — |
| `lark.endpoints[].webApiProxy` | object | 否 | — | 默认关闭；仅飞书出站API的loopback TLS故障代理，保留官方Host/SNI和证书校验，与streamProxy独立 |
| `lark.endpoints[].webApiProxy.port` | integer | 是 | — | — |
| `lark.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `lark.mode` | string: `"webhook"`, `"websocket"` | 否 | `"webhook"` | — |
| `lark.webApiProxy` | object | 否 | — | 默认关闭；仅飞书出站API的loopback TLS故障代理，保留官方Host/SNI和证书校验，与streamProxy独立 |
| `lark.webApiProxy.port` | integer | 是 | — | — |

### line

[`plugins/adapters/line/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/line/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `line.webhookPath` | string | 否 | `"/line/webhook"` | — |
| `line.apiBaseUrl` | string | 否 | `"https://api.line.me"` | — |
| `line.master` | string \| number | 否 | — | 框架 master（LINE user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `line.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `line.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `line.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（LINE user id）；覆盖顶层 master |
| `line.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `line.endpoints[].channelSecret` | string | 是 | — | LINE channel secret |
| `line.endpoints[].channelAccessToken` | string | 是 | — | LINE channel access token |
| `line.endpoints[].webhookPath` | string | 否 | — | — |
| `line.endpoints[].apiBaseUrl` | string | 否 | — | — |
| `line.endpoints[].commandPrefix` | string | 否 | — | — |
| `line.endpoints[].id` | string | 是 | — | LINE bot name |
| `line.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### milky

[`plugins/adapters/milky/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/milky/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `milky.connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | 否 | `"ws"` | ws (default), sse (EventSource client), webhook or wss (webhook/wss via httpHostToken) |
| `milky.reconnect_interval` | number | 否 | `5000` | — |
| `milky.heartbeat_interval` | number | 否 | `30000` | — |
| `milky.master` | string \| number | 否 | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `milky.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `milky.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `milky.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `milky.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `milky.endpoints[].connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | 否 | — | — |
| `milky.endpoints[].baseUrl` | string | 是 | — | Milky HTTP API base URL (required); WS event path is derived as ws(s)://host/event |
| `milky.endpoints[].path` | string | 否 | — | Path for webhook / reverse-wss |
| `milky.endpoints[].access_token` | string | 否 | — | Milky access token |
| `milky.endpoints[].reconnect_interval` | number | 否 | — | — |
| `milky.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `milky.endpoints[].commandPrefix` | string | 否 | — | — |
| `milky.endpoints[].id` | string | 是 | — | Milky bot name |
| `milky.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### napcat

[`plugins/adapters/napcat/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/napcat/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `napcat.connection` | string: `"ws"`, `"wss"`, `"http"` | 否 | `"ws"` | ws (default), wss (reverse WS), or http (POST webhook + HTTP API outbound) |
| `napcat.reconnect_interval` | number | 否 | `5000` | — |
| `napcat.heartbeat_interval` | number | 否 | `30000` | — |
| `napcat.poll_interval` | number | 否 | `30000` | — |
| `napcat.master` | string \| number | 否 | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `napcat.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `napcat.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `napcat.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `napcat.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `napcat.endpoints[].connection` | string: `"ws"`, `"wss"`, `"http"` | 否 | — | — |
| `napcat.endpoints[].url` | string | 否 | — | NapCat WebSocket URL (required for connection: ws) |
| `napcat.endpoints[].path` | string | 否 | — | WS path for reverse-wss |
| `napcat.endpoints[].http_url` | string | 否 | — | HTTP API base URL (connection: http outbound) |
| `napcat.endpoints[].post_path` | string | 否 | — | HTTP POST event path (connection: http inbound) |
| `napcat.endpoints[].access_token` | string | 否 | — | NapCat access token |
| `napcat.endpoints[].reconnect_interval` | number | 否 | — | — |
| `napcat.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `napcat.endpoints[].poll_interval` | number | 否 | — | — |
| `napcat.endpoints[].commandPrefix` | string | 否 | — | — |
| `napcat.endpoints[].id` | string | 是 | — | NapCat bot name |
| `napcat.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot11

[`plugins/adapters/onebot11/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot11/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `onebot11.connection` | string: `"ws"`, `"wss"` | 否 | `"ws"` | connection: ws (forward WS client, default) or wss (reverse WS via httpHostToken) |
| `onebot11.reconnect_interval` | number | 否 | `5000` | — |
| `onebot11.heartbeat_interval` | number | 否 | `30000` | — |
| `onebot11.master` | string \| number | 否 | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `onebot11.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `onebot11.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `onebot11.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `onebot11.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `onebot11.endpoints[].connection` | string: `"ws"`, `"wss"` | 否 | — | — |
| `onebot11.endpoints[].url` | string | 否 | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `onebot11.endpoints[].path` | string | 否 | — | WS path for reverse-wss (connection: wss) |
| `onebot11.endpoints[].access_token` | string | 否 | — | OneBot access token |
| `onebot11.endpoints[].reconnect_interval` | number | 否 | — | — |
| `onebot11.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `onebot11.endpoints[].commandPrefix` | string | 否 | — | — |
| `onebot11.endpoints[].id` | string | 是 | — | OneBot11 bot name |
| `onebot11.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot12

[`plugins/adapters/onebot12/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot12/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `onebot12.connection` | string: `"ws"`, `"webhook"`, `"wss"` | 否 | `"ws"` | ws (default), webhook (httpHostToken POST), or wss (reverse WS via httpHostToken) |
| `onebot12.reconnect_interval` | number | 否 | `5000` | — |
| `onebot12.heartbeat_interval` | number | 否 | `30000` | — |
| `onebot12.master` | string \| number | 否 | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `onebot12.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `onebot12.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `onebot12.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `onebot12.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `onebot12.endpoints[].connection` | string: `"ws"`, `"webhook"`, `"wss"` | 否 | — | — |
| `onebot12.endpoints[].url` | string | 否 | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `onebot12.endpoints[].path` | string | 否 | — | HTTP/WS path for webhook or reverse-wss |
| `onebot12.endpoints[].api_url` | string | 否 | — | HTTP action endpoint for webhook outbound (required for connection: webhook send) |
| `onebot12.endpoints[].access_token` | string | 否 | — | OneBot access token |
| `onebot12.endpoints[].reconnect_interval` | number | 否 | — | — |
| `onebot12.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `onebot12.endpoints[].commandPrefix` | string | 否 | — | — |
| `onebot12.endpoints[].id` | string | 是 | — | OneBot12 bot name |
| `onebot12.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### qq

[`plugins/adapters/qq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/qq/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `qq.mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | 否 | `"websocket"` | WebSocket gateway (default). webhook/middleware use httpHostToken POST. |
| `qq.sandbox` | boolean | 否 | `false` | — |
| `qq.botKind` | string: `"public"`, `"private"` | 否 | `"public"` | 公域/私域：均含 GROUP_AND_C2C_EVENT；频道消息分别为 PUBLIC_GUILD_MESSAGES / GUILD_MESSAGES。未显式配置 intents 时按此展开 |
| `qq.master` | string \| number | 否 | — | 框架 master（endpoint 管理命令、AI/工具权限）；openid。endpoints[i].master 可逐项覆盖 |
| `qq.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `qq.intents` | array&lt;string&gt; | 否 | — | WebSocket Identify intents；省略时按 botKind 自动生成（public→含 PUBLIC_GUILD_MESSAGES） |
| `qq.accessTokenUrl` | string | 否 | — | — |
| `qq.gatewayUrl` | string | 否 | — | — |
| `qq.webhookPath` | string | 否 | `"/qq/webhook"` | POST path on httpHostToken for webhook/middleware modes. |
| `qq.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项定义一个 endpoint，id/appid/secret 必填，其余字段覆盖实例默认值 |
| `qq.endpoints[].appid` | string | 是 | — | QQ official bot app ID |
| `qq.endpoints[].secret` | string | 是 | — | QQ official bot secret |
| `qq.endpoints[].mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | 否 | — | — |
| `qq.endpoints[].sandbox` | boolean | 否 | — | — |
| `qq.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（openid）；覆盖顶层 master |
| `qq.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `qq.endpoints[].botKind` | string: `"public"`, `"private"` | 否 | — | 覆盖顶层 botKind（公域/私域），用于按 endpoint 生成 intents |
| `qq.endpoints[].intents` | array&lt;string&gt; | 否 | — | 覆盖顶层 intents |
| `qq.endpoints[].accessTokenUrl` | string | 否 | — | — |
| `qq.endpoints[].gatewayUrl` | string | 否 | — | — |
| `qq.endpoints[].webhookPath` | string | 否 | — | — |
| `qq.endpoints[].commandPrefix` | string | 否 | — | — |
| `qq.endpoints[].id` | string | 是 | — | QQ bot name |
| `qq.endpoints[].streamProxy` | object | 否 | — | Optional fixed loopback TCP fault proxy for WSS only; original gateway TLS identity must match serverName. |
| `qq.endpoints[].streamProxy.port` | integer | 是 | — | — |
| `qq.endpoints[].streamProxy.serverName` | string | 是 | — | — |
| `qq.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `qq.streamProxy` | object | 否 | — | Optional fixed loopback TCP fault proxy for WSS only; original gateway TLS identity must match serverName. |
| `qq.streamProxy.port` | integer | 是 | — | — |
| `qq.streamProxy.serverName` | string | 是 | — | — |

### sandbox

[`plugins/adapters/sandbox/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/sandbox/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `sandbox.master` | string \| number | 否 | — | 框架 master（sandbox client id (distinct from endpoints[].owner)；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `sandbox.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `sandbox.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `sandbox.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（sandbox client id (distinct from endpoints[].owner)）；覆盖顶层 master |
| `sandbox.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `sandbox.endpoints[].owner` | string | 否 | — | Sandbox owner user ID |
| `sandbox.endpoints[].commandPrefix` | string | 否 | — | — |
| `sandbox.endpoints[].id` | string | 是 | — | Sandbox bot name |
| `sandbox.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### satori

[`plugins/adapters/satori/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/satori/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `satori.connection` | string: `"ws"`, `"webhook"` | 否 | `"ws"` | ws (default) or webhook (httpHostToken POST route) |
| `satori.heartbeat_interval` | number | 否 | `10000` | WS PING interval in milliseconds |
| `satori.master` | string \| number | 否 | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `satori.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `satori.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项定义一个 endpoint，id/baseUrl 必填，其余字段覆盖实例默认值 |
| `satori.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `satori.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `satori.endpoints[].baseUrl` | string | 是 | — | Satori SDK HTTP/WS base URL (e.g. http://127.0.0.1:5140) |
| `satori.endpoints[].connection` | string: `"ws"`, `"webhook"` | 否 | — | — |
| `satori.endpoints[].token` | string | 否 | — | Bearer token for API and WS IDENTIFY |
| `satori.endpoints[].path` | string | 否 | — | Webhook POST path (connection: webhook) |
| `satori.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `satori.endpoints[].commandPrefix` | string | 否 | — | — |
| `satori.endpoints[].id` | string | 是 | — | Satori bot name |
| `satori.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### slack

[`plugins/adapters/slack/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/slack/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `slack.socketMode` | boolean | 否 | `true` | Prefer Socket Mode (default). Set false for HTTP Events via httpHostToken. |
| `slack.webhookPath` | string | 否 | `"/slack/events"` | — |
| `slack.clientPingTimeout` | number | 否 | `15000` | Socket Mode client ping timeout (ms) |
| `slack.master` | string \| number | 否 | — | 框架 master（Slack user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `slack.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `slack.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `slack.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Slack user id）；覆盖顶层 master |
| `slack.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `slack.endpoints[].token` | string | 是 | — | Bot User OAuth Token (xoxb-...) |
| `slack.endpoints[].signingSecret` | string | 否 | — | Required for HTTP Events API (socketMode: false) |
| `slack.endpoints[].appToken` | string | 否 | — | App-Level Token (xapp-...) for Socket Mode |
| `slack.endpoints[].socketMode` | boolean | 否 | — | — |
| `slack.endpoints[].webhookPath` | string | 否 | — | — |
| `slack.endpoints[].clientPingTimeout` | number | 否 | — | — |
| `slack.endpoints[].commandPrefix` | string | 否 | — | — |
| `slack.endpoints[].id` | string | 是 | — | Slack bot name |
| `slack.endpoints[].streamProxy` | object | 否 | — | Socket故障验收：WSS固定loopback TCP，API仍标准TLS直连 |
| `slack.endpoints[].streamProxy.port` | integer | 是 | — | — |
| `slack.endpoints[].streamProxy.serverName` | string | 是 | — | — |
| `slack.endpoints[].webApiProxy` | object | 否 | — | 出站JSON Web API专用故障代理：仅slack.com:443，固定loopbackTCP，保留SNI和证书校验，与Socket代理独立；上传域名不适用 |
| `slack.endpoints[].webApiProxy.port` | integer | 是 | — | — |
| `slack.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### telegram

[`plugins/adapters/telegram/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/telegram/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `telegram.polling` | boolean | 否 | `true` | Long-poll getUpdates (default). Set false for webhook via httpHostToken. |
| `telegram.webhook` | object | 否 | — | Webhook settings when polling is false. |
| `telegram.webhook.domain` | string | 否 | — | — |
| `telegram.webhook.path` | string | 否 | `"/telegram/webhook"` | — |
| `telegram.webhook.secretToken` | string | 否 | — | Verified via X-Telegram-Bot-Api-Secret-Token. |
| `telegram.allowedUpdates` | array&lt;string&gt; | 否 | `["message","callback_query"]` | — |
| `telegram.apiBaseUrl` | string | 否 | `"https://api.telegram.org"` | — |
| `telegram.master` | string \| number | 否 | — | 框架 master（Telegram user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `telegram.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `telegram.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `telegram.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Telegram user id）；覆盖顶层 master |
| `telegram.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `telegram.endpoints[].token` | string | 是 | — | Telegram bot token |
| `telegram.endpoints[].polling` | boolean | 否 | — | — |
| `telegram.endpoints[].webhook` | object | 否 | — | — |
| `telegram.endpoints[].webhook.domain` | string | 否 | — | — |
| `telegram.endpoints[].webhook.path` | string | 否 | — | — |
| `telegram.endpoints[].webhook.secretToken` | string | 否 | — | — |
| `telegram.endpoints[].allowedUpdates` | array&lt;string&gt; | 否 | — | — |
| `telegram.endpoints[].apiBaseUrl` | string | 否 | — | — |
| `telegram.endpoints[].commandPrefix` | string | 否 | — | — |
| `telegram.endpoints[].id` | string | 是 | — | Telegram bot name |
| `telegram.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wechat-mp

[`plugins/adapters/wechat-mp/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wechat-mp/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `wechat-mp.path` | string | 否 | `"/wechat/webhook"` | — |
| `wechat-mp.encrypt` | boolean | 否 | `false` | — |
| `wechat-mp.encryptMode` | string: `"plain"`, `"compatible"`, `"secure"` | 否 | — | Default follows encrypt: 'plain' when encrypt=false, 'compatible' when encrypt=true |
| `wechat-mp.replyMode` | string: `"passive"`, `"customer_service"` | 否 | `"passive"` | — |
| `wechat-mp.passiveReplyTimeoutMs` | number | 否 | `4500` | — |
| `wechat-mp.master` | string \| number | 否 | — | 框架 master（WeChat OpenID；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `wechat-mp.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `wechat-mp.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `wechat-mp.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（WeChat OpenID）；覆盖顶层 master |
| `wechat-mp.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `wechat-mp.endpoints[].appId` | string | 是 | — | WeChat MP app ID |
| `wechat-mp.endpoints[].appSecret` | string | 是 | — | WeChat MP app secret |
| `wechat-mp.endpoints[].token` | string | 是 | — | WeChat MP callback token |
| `wechat-mp.endpoints[].encodingAESKey` | string | 否 | — | WeChat MP encoding AES key |
| `wechat-mp.endpoints[].path` | string | 否 | — | — |
| `wechat-mp.endpoints[].encrypt` | boolean | 否 | — | — |
| `wechat-mp.endpoints[].encryptMode` | string: `"plain"`, `"compatible"`, `"secure"` | 否 | — | — |
| `wechat-mp.endpoints[].replyMode` | string: `"passive"`, `"customer_service"` | 否 | — | — |
| `wechat-mp.endpoints[].passiveReplyTimeoutMs` | number | 否 | — | — |
| `wechat-mp.endpoints[].commandPrefix` | string | 否 | — | — |
| `wechat-mp.endpoints[].id` | string | 是 | — | WeChat MP bot name |
| `wechat-mp.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wecom

[`plugins/adapters/wecom/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wecom/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `wecom.webhookPath` | string | 否 | `"/wecom/callback"` | — |
| `wecom.apiBaseUrl` | string | 否 | `"https://qyapi.weixin.qq.com"` | — |
| `wecom.master` | string \| number | 否 | — | 框架 master（WeCom userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `wecom.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `wecom.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `wecom.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（WeCom userid）；覆盖顶层 master |
| `wecom.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `wecom.endpoints[].corpId` | string | 是 | — | WeCom corp ID |
| `wecom.endpoints[].agentSecret` | string | 是 | — | WeCom agent secret |
| `wecom.endpoints[].token` | string | 是 | — | WeCom callback token |
| `wecom.endpoints[].encodingAESKey` | string | 是 | — | WeCom encoding AES key |
| `wecom.endpoints[].webhookPath` | string | 否 | — | — |
| `wecom.endpoints[].apiBaseUrl` | string | 否 | — | — |
| `wecom.endpoints[].commandPrefix` | string | 否 | — | — |
| `wecom.endpoints[].id` | string | 是 | — | WeCom bot name |
| `wecom.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### weixin-ilink

[`plugins/adapters/weixin-ilink/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/weixin-ilink/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `weixin-ilink.botAgent` | string | 否 | — | — |
| `weixin-ilink.baseUrl` | string | 否 | `"https://ilinkai.weixin.qq.com"` | — |
| `weixin-ilink.cdnBaseUrl` | string | 否 | `"https://novac2c.cdn.weixin.qq.com/c2c"` | — |
| `weixin-ilink.longPollTimeoutMs` | number | 否 | `35000` | — |
| `weixin-ilink.dataDir` | string | 否 | `"data/weixin-ilink"` | Endpoint state root for credentials, cursors, context tokens, and media |
| `weixin-ilink.master` | string \| number | 否 | — | 框架 master（Weixin user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `weixin-ilink.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `weixin-ilink.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `weixin-ilink.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Weixin user id）；覆盖顶层 master |
| `weixin-ilink.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `weixin-ilink.endpoints[].botToken` | string | 否 | — | iLink bot token; omit to load endpoint state or start QR login |
| `weixin-ilink.endpoints[].id` | string | 是 | — | Weixin iLink bot name |
| `weixin-ilink.endpoints[].botAgent` | string | 否 | — | — |
| `weixin-ilink.endpoints[].baseUrl` | string | 否 | — | — |
| `weixin-ilink.endpoints[].cdnBaseUrl` | string | 否 | — | — |
| `weixin-ilink.endpoints[].longPollTimeoutMs` | number | 否 | — | — |
| `weixin-ilink.endpoints[].dataDir` | string | 否 | — | Endpoint state root |
| `weixin-ilink.endpoints[].commandPrefix` | string | 否 | — | 本 endpoint 的命令前缀 |
| `weixin-ilink.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### process-monitor

[`plugins/features/process-monitor/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/features/process-monitor/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `process-monitor.enabled` | boolean | 否 | `true` | 是否启用进程监控 |
| `process-monitor.notifyOnStart` | boolean | 否 | `true` | 首次启动时通知 |
| `process-monitor.notifyOnRestart` | boolean | 否 | `true` | 正常重启时通知 |
| `process-monitor.notifyOnCrash` | boolean | 否 | `true` | 异常崩溃重启时通知 |
| `process-monitor.notifyChannels` | array&lt;object&gt; | 否 | `[]` | 通知渠道（slice-1 仅 webhook 生效） |
| `process-monitor.notifyChannels[].type` | string: `"webhook"` | 是 | — | — |
| `process-monitor.notifyChannels[].target` | string | 是 | — | — |

### blackjack

[`plugins/games/blackjack/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/blackjack/schema.json)

_该 Schema 没有声明字段。_

### dice-duel

[`plugins/games/dice-duel/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/dice-duel/schema.json)

_该 Schema 没有声明字段。_

### dungeon-expedition

[`plugins/games/dungeon-expedition/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/dungeon-expedition/schema.json)

_该 Schema 没有声明字段。_

### guess-number

[`plugins/games/guess-number/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/guess-number/schema.json)

_该 Schema 没有声明字段。_

### hub

[`plugins/games/hub/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/hub/schema.json)

_该 Schema 没有声明字段。_

### idiom-chain

[`plugins/games/idiom-chain/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/idiom-chain/schema.json)

_该 Schema 没有声明字段。_

### roulette

[`plugins/games/roulette/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/roulette/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `roulette.chambers` | integer | 否 | `6` | 弹巢数量，其中一发是实弹 |
| `roulette.maxPlayers` | integer | 否 | `6` | 单局最多玩家数 |
| `roulette.turnTimeoutSeconds` | integer | 否 | `60` | 轮到的玩家超过这个秒数不开枪，判负 |
| `roulette.lobbyTimeoutSeconds` | integer | 否 | `300` | 开局后超过这个秒数仍未开始，自动解散 |
| `roulette.muteSeconds` | integer | 否 | `60` | 开启禁言惩罚的群里，输家被禁言的秒数（每个群默认关闭） |

### rps

[`plugins/games/rps/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/rps/schema.json)

_该 Schema 没有声明字段。_

### text-adventure

[`plugins/games/text-adventure/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/text-adventure/schema.json)

_该 Schema 没有声明字段。_

### tic-tac-toe

[`plugins/games/tic-tac-toe/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/tic-tac-toe/schema.json)

_该 Schema 没有声明字段。_

### word-riddle

[`plugins/games/word-riddle/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/games/word-riddle/schema.json)

_该 Schema 没有声明字段。_

### activity-feedback

[`plugins/services/activity-feedback/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/services/activity-feedback/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `activity-feedback.enabled` | boolean | 否 | `true` | 是否启用当前活动反馈插件实例。 |
| `activity-feedback.defaults` | object | 否 | — | 所有平台与 Endpoint 的默认策略。 |
| `activity-feedback.defaults.enabled` | boolean | 否 | `true` | 是否启用当前策略层。 |
| `activity-feedback.defaults.phases` | object | 否 | — | 按生命周期 phase 配置反馈策略。 |
| `activity-feedback.defaults.phases.queued` | object | 否 | — | — |
| `activity-feedback.defaults.phases.queued.private` | object | 否 | — | — |
| `activity-feedback.defaults.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.queued.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.queued.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.queued.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.queued.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.queued.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.queued.group` | object | 否 | — | — |
| `activity-feedback.defaults.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.queued.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.queued.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.queued.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.queued.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.queued.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.queued.channel` | object | 否 | — | — |
| `activity-feedback.defaults.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.queued.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.queued.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.queued.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.queued.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.queued.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.active` | object | 否 | — | — |
| `activity-feedback.defaults.phases.active.private` | object | 否 | — | — |
| `activity-feedback.defaults.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.active.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.active.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.active.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.active.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.active.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.active.group` | object | 否 | — | — |
| `activity-feedback.defaults.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.active.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.active.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.active.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.active.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.active.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.active.channel` | object | 否 | — | — |
| `activity-feedback.defaults.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.active.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.active.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.active.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.active.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.active.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.thinking` | object | 否 | — | — |
| `activity-feedback.defaults.phases.thinking.private` | object | 否 | — | — |
| `activity-feedback.defaults.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.thinking.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.thinking.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.thinking.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.thinking.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.thinking.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.thinking.group` | object | 否 | — | — |
| `activity-feedback.defaults.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.thinking.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.thinking.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.thinking.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.thinking.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.thinking.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.thinking.channel` | object | 否 | — | — |
| `activity-feedback.defaults.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.thinking.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.thinking.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.thinking.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.thinking.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.thinking.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_start` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_start.private` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_start.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_start.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_start.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_start.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_start.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_start.group` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_start.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_start.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_start.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_start.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_start.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_start.channel` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_start.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_start.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_start.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_start.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_start.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_finish` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_finish.private` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_finish.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_finish.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_finish.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_finish.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_finish.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_finish.group` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_finish.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_finish.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_finish.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_finish.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_finish.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_finish.channel` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_finish.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_finish.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_finish.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_finish.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_finish.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_error` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_error.private` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_error.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_error.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_error.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_error.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_error.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_error.group` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_error.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_error.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_error.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_error.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_error.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.defaults.phases.schedule_error.channel` | object | 否 | — | — |
| `activity-feedback.defaults.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.defaults.phases.schedule_error.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.defaults.phases.schedule_error.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.defaults.phases.schedule_error.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.defaults.phases.schedule_error.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.defaults.phases.schedule_error.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms` | object | 否 | — | 按平台名覆盖；值的结构与 defaults 相同。 |
| `activity-feedback.platforms.<platform>.enabled` | boolean | 否 | `true` | 是否启用当前策略层。 |
| `activity-feedback.platforms.<platform>.phases` | object | 否 | — | 按生命周期 phase 配置反馈策略。 |
| `activity-feedback.platforms.<platform>.phases.queued` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.private` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.queued.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.queued.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.queued.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.queued.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.queued.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.queued.group` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.queued.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.queued.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.queued.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.queued.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.queued.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.queued.channel` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.queued.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.queued.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.queued.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.queued.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.queued.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.active` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.active.private` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.active.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.active.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.active.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.active.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.active.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.active.group` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.active.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.active.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.active.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.active.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.active.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.active.channel` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.active.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.active.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.active.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.active.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.active.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.thinking` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.private` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.thinking.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.thinking.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.thinking.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.thinking.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.thinking.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.thinking.group` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.thinking.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.thinking.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.thinking.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.thinking.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.thinking.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.thinking.channel` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.thinking.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_start.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_finish.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel` | object | 否 | — | — |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.platforms.<platform>.phases.schedule_error.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints` | object | 否 | — | 按 platform:endpointKey 覆盖；值的结构与 defaults 相同。 |
| `activity-feedback.endpoints.<platform:endpointKey>.enabled` | boolean | 否 | `true` | 是否启用当前策略层。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases` | object | 否 | — | 按生命周期 phase 配置反馈策略。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel` | object | 否 | — | — |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule` | object | 否 | — | 仅用于 Schedule 的开始、完成与失败反馈。 |
| `activity-feedback.schedule.phases` | object | 否 | — | — |
| `activity-feedback.schedule.phases.start` | object | 否 | — | — |
| `activity-feedback.schedule.phases.start.private` | object | 否 | — | — |
| `activity-feedback.schedule.phases.start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.start.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.start.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.start.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.start.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.start.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.start.group` | object | 否 | — | — |
| `activity-feedback.schedule.phases.start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.start.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.start.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.start.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.start.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.start.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.start.channel` | object | 否 | — | — |
| `activity-feedback.schedule.phases.start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.start.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.start.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.start.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.start.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.start.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.finish` | object | 否 | — | — |
| `activity-feedback.schedule.phases.finish.private` | object | 否 | — | — |
| `activity-feedback.schedule.phases.finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.finish.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.finish.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.finish.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.finish.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.finish.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.finish.group` | object | 否 | — | — |
| `activity-feedback.schedule.phases.finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.finish.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.finish.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.finish.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.finish.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.finish.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.finish.channel` | object | 否 | — | — |
| `activity-feedback.schedule.phases.finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.finish.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.finish.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.finish.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.finish.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.finish.channel.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.error` | object | 否 | — | — |
| `activity-feedback.schedule.phases.error.private` | object | 否 | — | — |
| `activity-feedback.schedule.phases.error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.error.private.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.error.private.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.error.private.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.error.private.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.error.private.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.error.group` | object | 否 | — | — |
| `activity-feedback.schedule.phases.error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.error.group.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.error.group.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.error.group.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.error.group.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.error.group.platformConfig` | object | 否 | — | 平台特定选项。 |
| `activity-feedback.schedule.phases.error.channel` | object | 否 | — | — |
| `activity-feedback.schedule.phases.error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | 否 | — | 该 phase 的呈现方式。 |
| `activity-feedback.schedule.phases.error.channel.emoji` | string | 否 | — | type=reaction 时使用的回应值。 |
| `activity-feedback.schedule.phases.error.channel.message` | string | 否 | — | type=message 时使用的状态文本。 |
| `activity-feedback.schedule.phases.error.channel.autoRemove` | boolean | 否 | `true` | phase 停止后是否自动移除反馈。 |
| `activity-feedback.schedule.phases.error.channel.removeDelay` | number | 否 | — | 自动移除前等待的毫秒数；负值会在运行时归一化为 0。 |
| `activity-feedback.schedule.phases.error.channel.platformConfig` | object | 否 | — | 平台特定选项。 |

### typesafe

[`plugins/services/typesafe/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/services/typesafe/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `typesafe.enabled` | boolean | 否 | `true` | 启用该决策服务。 |
| `typesafe.apiKey` | string | 否 | — | 通过环境变量 TYPESAFE_API_KEY 引用密钥。 |
| `typesafe.model` | string | 否 | `"jev-latest"` | 模型名称；校准后的策略应固定模型版本。 |
| `typesafe.baseUrl` | string | 否 | `"https://api.typesafe.ai"` | API 根地址，不包含凭据、查询或片段。 |
| `typesafe.timeoutMs` | integer | 否 | `10000` | 包含全部请求与重试等待的总超时。 |
| `typesafe.maxRetries` | integer | 否 | `2` | 首次请求后的最大重试次数。 |

### 60s

[`plugins/utils/60s/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/60s/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `60s.apiBase` | string | 否 | `"https://60s.viki.moe"` | 60s API base URL |

### answers

[`plugins/utils/answers/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/answers/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `answers.dailyStable` | boolean | 否 | `false` | 同一用户同一天问同一个问题时，答案之书给出相同答案 |
| `answers.timezone` | string | 否 | `"Asia/Shanghai"` | dailyStable 判断「同一天」所用的 IANA 时区 |
| `answers.quizTimeoutSeconds` | number | 否 | `120` | 出题后等待作答的秒数，超时题目作废 |
| `answers.enableDrivingQuiz` | boolean | 否 | `true` | 启用「科目一」交规小测（原创题面，仅供娱乐参考） |

### bilibili

[`plugins/utils/bilibili/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/bilibili/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `bilibili.pollCron` | string | 否 | `"0 * * * * *"` | 轮询频率（6 段 Cron，默认每 60 秒） / Poll schedule (6-field cron, default every 60s) |
| `bilibili.jitterMs` | number | 否 | `15000` | 每轮轮询前的随机延迟上限（毫秒） / Max random delay before each poll (ms) |
| `bilibili.requestGapMs` | number | 否 | `1500` | 同一轮内相邻动态请求的间隔（毫秒） / Gap between dynamic requests within one poll (ms) |
| `bilibili.maxBackoffMinutes` | number | 否 | `30` | 接口失败或风控时指数退避的上限（分钟） / Upper bound of exponential backoff (minutes) |
| `bilibili.maxPerChannel` | number | 否 | `20` | 每个会话最多订阅的 UP 主数量 / Max UP subscriptions per conversation |
| `bilibili.timeout` | number | 否 | `10000` | 单次 HTTP 请求超时（毫秒） / HTTP timeout (ms) |
| `bilibili.live` | boolean | 否 | `true` | 是否轮询开播状态 / Poll live status |
| `bilibili.dynamic` | boolean | 否 | `true` | 是否轮询 UP 主动态 / Poll UP dynamics |
| `bilibili.cookie` | string | 否 | `""` | 可选的 B 站 Cookie（如 SESSDATA=...），风控严格时使用，请写成 ${BILIBILI_COOKIE} / Optional cookie, reference it as ${BILIBILI_COOKIE} |

### calendar

[`plugins/utils/calendar/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/calendar/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `calendar.provider` | `"none"` \| `"caldav"` \| `"google"` \| `"microsoft"` | 否 | `"none"` | 日历后端；none 时工具返回未启用提示 |
| `calendar.timezone` | string | 否 | `"Asia/Manila"` | 解释无偏移时间与展示用的 IANA 时区 |
| `calendar.work_day_start` | string | 否 | `"09:00"` | — |
| `calendar.work_day_end` | string | 否 | `"18:00"` | — |
| `calendar.oauth_redirect_base_url` | string | 否 | `""` | 聊天授权回调的外部基础地址（如 https://bot.example.com）；留空时使用 zhin HTTP Host 的本机地址 |
| `calendar.oauth_callback_path` | string | 否 | `"/calendar/oauth/callback"` | 聊天授权回调路由，挂在 zhin HTTP Host 上；反向代理/隧道只转发部分路径时可调整 |
| `calendar.caldav` | object | 否 | — | — |
| `calendar.caldav.enabled` | boolean | 否 | `false` | — |
| `calendar.caldav.calendar_url` | string | 否 | `""` | 日历 collection URL |
| `calendar.caldav.username` | string | 否 | `""` | — |
| `calendar.caldav.password` | string | 否 | `""` | — |
| `calendar.google` | object | 否 | — | — |
| `calendar.google.enabled` | boolean | 否 | `false` | — |
| `calendar.google.client_id` | string | 否 | `""` | ${GOOGLE_CALENDAR_CLIENT_ID} |
| `calendar.google.client_secret` | string | 否 | `""` | ${GOOGLE_CALENDAR_CLIENT_SECRET} |
| `calendar.google.refresh_token` | string | 否 | `""` | ${GOOGLE_CALENDAR_REFRESH_TOKEN}；用 auth google 获取 |
| `calendar.google.calendar_id` | string | 否 | `"primary"` | 日历 ID，默认 primary；可换成其它日历的 id |
| `calendar.google.token_file` | string | 否 | `""` | 可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-google-token.json） |
| `calendar.microsoft` | object | 否 | — | — |
| `calendar.microsoft.enabled` | boolean | 否 | `false` | — |
| `calendar.microsoft.client_id` | string | 否 | `""` | ${MS_GRAPH_CLIENT_ID} |
| `calendar.microsoft.client_secret` | string | 否 | `""` | 可选；公共客户端可留空。${MS_GRAPH_CLIENT_SECRET} |
| `calendar.microsoft.refresh_token` | string | 否 | `""` | ${MS_GRAPH_REFRESH_TOKEN}；用 auth microsoft 获取 |
| `calendar.microsoft.tenant` | string | 否 | `"common"` | Azure tenant，默认 common |
| `calendar.microsoft.calendar_id` | string | 否 | `""` | 留空或 primary/me = 默认日历；否则为 Graph calendar id |
| `calendar.microsoft.token_file` | string | 否 | `""` | 可选：持久化轮换后的 refresh_token 的 JSON 路径（如 data/calendar-ms-token.json） |

### code-runner

[`plugins/utils/code-runner/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/code-runner/schema.json)

_该 Schema 没有声明字段。_

### content-moderation

[`plugins/utils/content-moderation/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/content-moderation/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `content-moderation.groupModeration` | array&lt;object&gt; | 否 | `[]` | 自动广告/辱骂审核的精确范围；未配置时关闭。需要 AI、原子持久状态和适配器群管支持。 |
| `content-moderation.groupModeration[].adapter` | string | 是 | — | — |
| `content-moderation.groupModeration[].endpoint` | string | 是 | — | — |
| `content-moderation.groupModeration[].account` | string | 是 | — | — |
| `content-moderation.groupModeration[].group` | string | 是 | — | — |
| `content-moderation.enabled` | boolean | 否 | `true` | 总开关 |
| `content-moderation.onError` | string: `"open"`, `"closed"` | 否 | `"open"` | 审查源失败时的全局默认策略：open=视为通过，closed=视为 critical |
| `content-moderation.maskChar` | string | 否 | `"*"` | 文本打码字符 |
| `content-moderation.replyTemplate` | string | 否 | `"消息含不当内容，已拦截。"` | reply 动作时的提示文案 |
| `content-moderation.masters` | array&lt;string&gt; | 否 | `[]` | 额外视为 master 的 userId（兜底，与 endpoint master 合并） |
| `content-moderation.inbound` | object | 否 | — | — |
| `content-moderation.inbound.enabled` | boolean | 否 | `true` | — |
| `content-moderation.inbound.bypassMasters` | boolean | 否 | `true` | master 跳过入站审查 |
| `content-moderation.inbound.whitelist` | object | 否 | — | — |
| `content-moderation.inbound.whitelist.userIds` | array&lt;string&gt; | 否 | `[]` | — |
| `content-moderation.inbound.whitelist.conversationIds` | array&lt;string&gt; | 否 | `[]` | — |
| `content-moderation.outbound` | object | 否 | — | — |
| `content-moderation.outbound.enabled` | boolean | 否 | `true` | — |
| `content-moderation.outbound.bypass` | boolean | 否 | `false` | 为 true 时跳过出站审查 |
| `content-moderation.actions` | object | 否 | — | severity → 动作（字符串或数组）；缺省用偏严默认表 |
| `content-moderation.actions.pass` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.low` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.medium` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.high` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.critical` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.sources` | array&lt;object&gt; | 否 | `[]` | — |
| `content-moderation.sources[].id` | string | 是 | — | — |
| `content-moderation.sources[].type` | string: `"local"`, `"http"` | 是 | — | — |
| `content-moderation.sources[].enabled` | boolean | 否 | `true` | — |
| `content-moderation.sources[].onError` | string: `"open"`, `"closed"` | 否 | — | — |
| `content-moderation.sources[].includeBuiltin` | boolean | 否 | `true` | 是否合并内置分级违禁词词库 |
| `content-moderation.sources[].words` | array&lt;string \| object&gt; | 否 | `[]` | 自定义词：字符串（用 defaultSeverity）或 { word, severity } |
| `content-moderation.sources[].wordFiles` | array&lt;string&gt; | 否 | `[]` | 词库文件；行格式 word / severity:word / word\|severity |
| `content-moderation.sources[].defaultSeverity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | 否 | `"high"` | 未标注分级的自定义词默认 severity |
| `content-moderation.sources[].severity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | 否 | `"high"` | 兼容旧字段，等同 defaultSeverity |
| `content-moderation.sources[].url` | string | 否 | — | — |
| `content-moderation.sources[].headers` | object | 否 | — | — |
| `content-moderation.sources[].timeoutMs` | number | 否 | `5000` | — |
| `content-moderation.sources[].forceUpload` | boolean | 否 | `false` | 强制下载图片后上传，不传 URL |

### earthquake

[`plugins/utils/earthquake/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/earthquake/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `earthquake.sources` | array&lt;string: `"cenc"`, `"usgs"`&gt; | 否 | `["cenc","usgs"]` | 启用的数据源及优先顺序；合并同一地震时排在前面的数据源提供地点文字，某个数据源失败时由其余数据源兜底 |
| `earthquake.cencUrls` | array&lt;string&gt; | 否 | `["https://api.wolfx.jp/cenc_eqlist.json","https://ceic.ac.cn/data/data.json"]` | CENC 地震目录地址，按顺序尝试（首个为主源，其余为备用镜像）；仅支持 HTTPS，最多 5 个 |
| `earthquake.usgsFeed` | string: `"significant_hour"`, `"significant_day"`, `"4.5_hour"`, `"4.5_day"`, `"2.5_hour"`, `"2.5_day"`, `"1.0_hour"`, `"1.0_day"` | 否 | `"2.5_day"` | USGS GeoJSON 汇总源名称（震级下限_时间范围） |
| `earthquake.pollCron` | string | 否 | `"0 */2 * * * *"` | 订阅轮询频率（6 段 Cron：秒 分 时 日 月 周） |
| `earthquake.timezone` | string | 否 | `"Asia/Shanghai"` | 显示发震时刻使用的 IANA 时区 |
| `earthquake.requestTimeoutMs` | number | 否 | `10000` | 单次 HTTP 请求超时（毫秒） |
| `earthquake.maxRetries` | number | 否 | `2` | 网络错误、超时、429 与 5xx 的重试次数（不含首次请求） |
| `earthquake.retryBaseDelayMs` | number | 否 | `1000` | 指数退避的首次等待（毫秒），每次重试翻倍并加入随机抖动 |
| `earthquake.retryMaxDelayMs` | number | 否 | `30000` | 单次退避或 Retry-After 等待上限（毫秒）；服务端要求更久时本轮放弃并冷却该数据源 |
| `earthquake.defaultMinMagnitude` | number | 否 | `5` | 订阅未指定震级时使用的最小震级 |
| `earthquake.queryMinMagnitude` | number | 否 | `3` | 「地震」查询未指定震级时使用的最小震级 |
| `earthquake.queryLimit` | number | 否 | `5` | 「地震」查询默认列出的条数 |
| `earthquake.maxEventAgeMinutes` | number | 否 | `60` | 只推送发震时间在此分钟数以内的地震，避免推送迟到或重放的旧事件 |
| `earthquake.pushLimit` | number | 否 | `3` | 每个会话在一个限流窗口内最多推送的消息数 |
| `earthquake.pushWindowMinutes` | number | 否 | `10` | 推送限流窗口长度（分钟） |
| `earthquake.maxEventsPerMessage` | number | 否 | `5` | 单条推送消息最多列出的地震数，其余以数量概括 |
| `earthquake.maxSubscriptions` | number | 否 | `100` | 本实例所有会话的订阅总数上限（每个会话最多一个订阅） |

### group-suite

[`plugins/utils/group-suite/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `group-suite.keywordReply` | boolean | 否 | `false` | — |
| `group-suite.basePointsMin` | number | 否 | `10` | — |
| `group-suite.basePointsMax` | number | 否 | `30` | — |
| `group-suite.streakBonus` | number | 否 | `5` | — |
| `group-suite.streakCap` | number | 否 | `50` | — |
| `group-suite.rankSize` | number | 否 | `10` | — |
| `group-suite.teachMaxPerGroup` | number | 否 | `200` | — |
| `group-suite.teachCooldownMs` | number | 否 | `3000` | — |
| `group-suite.teachAllowRegex` | boolean | 否 | `true` | — |
| `group-suite.teachPageSize` | number | 否 | `10` | — |
| `group-suite.welcomeMessage` | string | 否 | `""` | Group welcome text. Empty disables; {name}/{id} refer to the joined member. |
| `group-suite.welcomeConversations` | array&lt;object&gt; | 否 | — | Exact welcome conversations. Omitted welcomes all groups; [] welcomes none. Missing parent/thread requires their absence; no wildcards. |
| `group-suite.welcomeConversations[].endpoint` | object | 是 | — | — |
| `group-suite.welcomeConversations[].endpoint.adapter` | string | 是 | — | — |
| `group-suite.welcomeConversations[].endpoint.id` | string | 是 | — | — |
| `group-suite.welcomeConversations[].kind` | string: `"group"` | 是 | — | — |
| `group-suite.welcomeConversations[].id` | string | 是 | — | — |
| `group-suite.welcomeConversations[].parent` | object | 否 | — | — |
| `group-suite.welcomeConversations[].parent.kind` | string: `"private"`, `"group"`, `"channel"` | 是 | — | — |
| `group-suite.welcomeConversations[].parent.id` | string | 是 | — | — |
| `group-suite.welcomeConversations[].threadId` | string | 否 | — | — |
| `group-suite.ephemeralKeywords` | boolean | 否 | `false` | Explicit volatile keywords. With false, automatic replies require Database Host at startup and keyword management requires its persistent state service when invoked. |

### ledger

[`plugins/utils/ledger/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/ledger/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `ledger.timezone` | string | 否 | `"Asia/Shanghai"` | 计算今日、本周（周一开始）、本月与日报日期所用的 IANA 时区 |
| `ledger.reportTime` | string | 否 | `"22:00"` | 记账日报的发送时间（HH:MM，按 timezone）；只发给用「记账日报 开启」订阅的用户 |
| `ledger.reportWhenEmpty` | boolean | 否 | `false` | 当天没有记账时是否仍发送日报 |

### link-poster

[`plugins/utils/link-poster/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/link-poster/schema.json)

_该 Schema 没有声明字段。_

### lottery

[`plugins/utils/lottery/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/lottery/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `lottery.pickCount` | number | 否 | `5` | — |
| `lottery.scheduleCron` | string | 否 | `"0 0 18 * * *"` | — |
| `lottery.historyLimit` | number | 否 | `500` | — |
| `lottery.scheduleEnabled` | boolean | 否 | `true` | — |
| `lottery.backtestEnabled` | boolean | 否 | `true` | — |
| `lottery.backtestWindow` | number | 否 | `50` | — |
| `lottery.backtestRandomTrials` | number | 否 | `64` | — |
| `lottery.backtestMinHistory` | number | 否 | `30` | — |
| `lottery.backtestAdaptive` | boolean | 否 | `true` | — |
| `lottery.weightPersistEnabled` | boolean | 否 | `true` | — |
| `lottery.weightHoldoutFallback` | boolean | 否 | `true` | — |
| `lottery.games` | array&lt;string&gt; | 否 | `["kl8","ssq","dlt","fc3d","pl3","pl5"]` | — |
| `lottery.pushTargets` | array&lt;object&gt; | 否 | `[]` | OutboundHost push destinations for cron/publish reports |
| `lottery.pushTargets[].adapter` | string | 是 | — | — |
| `lottery.pushTargets[].endpointId` | string | 否 | — | — |
| `lottery.pushTargets[].channelType` | string | 否 | `"private"` | — |
| `lottery.pushTargets[].channelId` | string | 是 | — | — |
| `lottery.kl8` | object | 否 | — | — |
| `lottery.kl8.pickCount` | number | 否 | `5` | — |
| `lottery.kl8.recommendGroups` | number | 否 | `3` | — |
| `lottery.kl8.groupStrategies` | array&lt;string&gt; | 否 | `["balanced","hot","cold"]` | — |

### music

[`plugins/utils/music/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/music/schema.json)

_该 Schema 没有声明字段。_

### nettools

[`plugins/utils/nettools/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/nettools/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `nettools.cooldownSeconds` | integer | 否 | `10` | Per-user cooldown in seconds, shared by all nettools commands and tools (0 disables) |
| `nettools.requestTimeoutMs` | integer | 否 | `8000` | Per-attempt timeout for each external HTTP request, in milliseconds |
| `nettools.maxRetries` | integer | 否 | `2` | Retries for transient failures (network errors, timeouts, 429, 5xx) with exponential backoff and jitter |
| `nettools.pingMaxNodes` | integer | 否 | `4` | Number of check-host.net probe nodes used by ping |
| `nettools.pingPollIntervalMs` | integer | 否 | `2000` | Wait between ping result polls, in milliseconds |
| `nettools.pingMaxPolls` | integer | 否 | `5` | Maximum number of ping result polls before reporting partial results |
| `nettools.dohProviders` | array&lt;string: `"cloudflare"`, `"alidns"`, `"google"`&gt; | 否 | `["cloudflare","alidns","google"]` | DNS-over-HTTPS providers in fallback order |
| `nettools.priceListLimit` | integer | 否 | `8` | Number of registrars shown in a domain price comparison |

### qrcode

[`plugins/utils/qrcode/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/qrcode/schema.json)

_该 Schema 没有声明字段。_

### reminder

[`plugins/utils/reminder/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/reminder/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `reminder.timezone` | string | 否 | `"UTC"` | 解释 create 自然时间并显示提醒的 IANA 时区；ISO 绝对时间仍须显式 offset |
| `reminder.maxTasks` | number | 否 | `20` | 每实例聊天个人提醒池的活跃任务上限；与管理员池独立，降低上限不删除既有任务 |
| `reminder.adminMaxTasks` | number | 否 | `20` | 每实例管理员提醒池的活跃任务上限（待执行、暂停或未确认）；与聊天池独立，两池总量可达上限之和 |
| `reminder.maxTasksPerSender` | number | 否 | `10` | 同一发送者在同一会话的任务上限 |
| `reminder.batchSize` | number | 否 | `5` | 每次扫描最多投递的任务数 |
| `reminder.missedGraceSeconds` | number | 否 | `15` | 周期轮次超过此延迟后跳过；停机期间不补历史轮次 |

### repeater

[`plugins/utils/repeater/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/repeater/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `repeater.threshold` | number | 否 | `3` | 触发复读的最少人数 |
| `repeater.cooldown` | number | 否 | `30000` | 同一群冷却时间 (ms) |
| `repeater.maxLength` | number | 否 | `200` | 消息长度上限 |

### rss

[`plugins/utils/rss/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/rss/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `rss.pollCron` | string | 否 | `"0 */5 * * * *"` | 轮询频率 (6 段 Cron 表达式) |
| `rss.maxPerGroup` | number | 否 | `30` | — |
| `rss.maxItems` | number | 否 | `5` | — |
| `rss.timeout` | number | 否 | `15000` | — |

### short-url

[`plugins/utils/short-url/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/short-url/schema.json)

_该 Schema 没有声明字段。_
