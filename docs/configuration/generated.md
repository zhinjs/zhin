---
title: 自动生成配置字段参考
outline: [2, 3]
---

# 自动生成配置字段参考

> 本页由源码与 JSON Schema 自动生成，请勿手工编辑。叙事、示例与配置方法见[配置参考](./)。

- 生成命令: `pnpm docs:config`
- 漂移检查: `pnpm check:config-reference`

## Host 顶层字段

权威契约来自 Runtime 实际消费的 [`packages/im/runtime/src/host-config-schema.json`](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json)；消费位置见 [`packages/host/gateway/src/config/configuration-projection.ts`](https://github.com/zhinjs/zhin/blob/main/packages/host/gateway/src/config/configuration-projection.ts)。

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
| `http.token` | string \| null | 否 | — | 初始化令牌：创建第一个 Console 所有者之前用于登录初始化向导；之后失效（ADR 0049）。 |
| `http.corsOrigins` | array \| null | 否 | — | — |
| `http.trustProxy` | boolean \| integer \| array&lt;string&gt; \| string | 否 | — | 受信任的反向代理，其 X-Forwarded-For / Forwarded 头给出真实客户端地址（登录限流、审计 IP、仅本机套接字）：false（默认）只用 TCP 对端地址；true 信任所有跳；数字表示信任离服务端最近的若干跳；列表表示只信任匹配的 IP / CIDR 或 loopback、private、linklocal。 |
| `http.base` | string \| null | 否 | — | API 路径前缀。 |
| `http.tls` | `false` \| null \| object | 否 | — | — |
| `http.listeners` | array&lt;object&gt; | 否 | — | — |
| `http.listeners[].enabled` | boolean \| string | 否 | — | 是否启用此监听器。 |
| `http.listeners[].host` | string | 否 | — | 监听地址。 |
| `http.listeners[].port` | number \| string | 否 | — | 监听端口。 |
| `http.listeners[].tls` | `false` \| null \| object | 否 | — | — |
| `console` | object | 否 | — | Console 宿主功能。 |
| `console.terminal` | object | 否 | — | Console 终端（宿主 Shell / SSH），仅持有 ops.terminal 的所有者可用；默认关闭。 |
| `console.terminal.enabled` | boolean | 否 | `false` | 注册终端路由。 |
| `console.terminal.shell` | string | 否 | — | 本机 Shell；省略时用 $SHELL（Windows 为 powershell.exe）。 |
| `console.terminal.cwd` | string | 否 | `"."` | 工作目录，相对项目根。 |
| `console.terminal.idleTimeout` | integer | 否 | `900` | 无输入多少秒后断开（0 表示不限）。 |
| `console.terminal.maxSessions` | integer | 否 | `4` | 所有用户合计的同时会话上限。 |
| `console.terminal.ssh` | array&lt;object&gt; | 否 | — | Console 可连接的 SSH 目标。 |
| `console.terminal.ssh[].name` | string | 是 | — | 目标 id，Console 按它选择（不能是 local）。 |
| `console.terminal.ssh[].label` | string | 否 | — | 显示名称。 |
| `console.terminal.ssh[].host` | string | 是 | — | SSH 主机。 |
| `console.terminal.ssh[].port` | integer | 否 | `22` | SSH 端口。 |
| `console.terminal.ssh[].username` | string | 是 | — | SSH 用户。 |
| `console.terminal.ssh[].privateKeyPath` | string | 否 | — | 私钥文件（相对项目根，可用 ~）；与 privateKeyEnv 互斥。 |
| `console.terminal.ssh[].privateKeyEnv` | string | 否 | — | 保存私钥的环境变量名。 |
| `console.terminal.ssh[].passwordEnv` | string | 否 | — | 保存密码的环境变量名。 |
| `console.terminal.ssh[].passphraseEnv` | string | 否 | — | 保存私钥口令的环境变量名。 |
| `console.terminal.ssh[].hostFingerprint` | string | 否 | — | 必填的主机密钥指纹（SHA256:…），严格校验；在可信网络中用 `ssh-keyscan -t ed25519 &lt;host&gt; \| ssh-keygen -lf -` 获取。 |
| `console.terminal.ssh[].insecureAcceptAnyHostKey` | boolean | 否 | — | 不校验主机密钥、接受任意密钥（不安全，可被中间人攻击）；仅在不填 hostFingerprint 时使用，Console 会把该目标标为不安全。 |
| `console.loginAssist` | object | 否 | — | Console 中的登录辅助（ADR 0058）。 |
| `console.loginAssist.captchaHelperUrl` | string | 否 | — | 独立源上的验证码辅助页；默认 https://zhin.js.org/login-assist/tcaptcha.html。 |
| `gateway` | object | 否 | — | 管理网关（zhin start）：实例监管与依赖事务。 |
| `gateway.readyTimeout` | integer | 否 | `60` | 实例启动、重启或依赖事务后报告就绪的最长秒数；超时视为启动失败（依赖事务随之回滚）。每次启动、重启与事务前重新读取，修改后无需重启网关。 |
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
| `database.console` | object | 否 | — | PostgreSQL / MySQL：Console SQL 控制台使用的受限账号（ADR 0059；zhin db console-role 创建）。未配置时原始 SQL 关闭。 |
| `database.console.user` | string | 否 | — | 受限账号用户名，通常写 ${ZHIN_DB_CONSOLE_USER}。 |
| `database.console.password` | string | 否 | — | 受限账号密码，写 ${ZHIN_DB_CONSOLE_PASSWORD}，值只放 .env。 |
| `ai` | object | 否 | — | Provider、Agent、会话、记忆、工具与执行安全策略。 |
| `ai.venues` | array&lt;object&gt; | 否 | — | 多 Bot 共享 IM 房间（ADR 0048 §3.2）。 |
| `ai.venues[].id` | string | 是 | — | — |
| `ai.venues[].label` | string | 否 | — | — |
| `ai.venues[].conversation` | object | 是 | — | — |
| `ai.venues[].conversation.platform` | string | 是 | — | — |
| `ai.venues[].conversation.sceneType` | string: `"private"`, `"group"`, `"channel"` | 否 | — | — |
| `ai.venues[].conversation.sceneId` | string | 是 | — | — |
| `ai.venues[].conversation.threadId` | string | 否 | — | — |
| `ai.venues[].members` | array&lt;object&gt; | 是 | — | — |
| `ai.venues[].members[].agent` | string | 是 | — | — |
| `ai.venues[].members[].botEndpoint` | string | 是 | — | — |
| `ai.venues[].members[].aliases` | array&lt;string&gt; | 否 | — | — |
| `ai.venues[].entry` | string | 否 | — | — |
| `ai.venues[].visibility` | string: `"visible"`, `"summary"`, `"backstage"` | 否 | — | — |
| `ai.externalPeers` | array&lt;object&gt; | 否 | — | 显式声明的外部第三方 Bot 账号（ADR 0043/0048）。 |
| `ai.externalPeers[].platform` | string | 是 | — | — |
| `ai.externalPeers[].userId` | string | 是 | — | — |
| `ai.externalPeers[].label` | string | 否 | — | — |
| `ai.agent` | object | 否 | — | Agent 执行、排队、工具与模型策略。 |
| `ai.agent.mailbox` | object | 否 | — | Agent 收件箱（Mailbox）的 IM 收件策略（ADR 0048 H3；由 inboundQueue 改名，旧键会导致启动失败）。 |
| `ai.agent.mailbox.groupMode` | string: `"supersede"`, `"fifo"` | 否 | — | supersede（默认）：同一发起人的新消息会替换他自己尚未回复的回合；fifo：全部按到达顺序排队。其他成员的消息总是排队。 |
| `ai.agent.mailbox.ttlMs` | integer | 否 | `180000` | 排队超过该时长的回合会被丢弃并简短提示；0 表示不过期。 |
| `ai.agent.mailbox.maxQueuedTurns` | integer | 否 | `5` | 同一会话中允许排在当前回合之后的回合数；超出时回复一句“正在忙”。 |
| `ai.agent.mailbox.merge` | object | 否 | — | 群聊合流窗口（ADR 0038）：短时间内多人点名 Bot 时合并为一次回复。私聊、主人、指令、叫停以及带媒体 / 引用 / 转发的消息不参与合流。 |
| `ai.agent.mailbox.merge.enabled` | boolean | 否 | `true` | 开启群聊合流（仅群聊）。设为 false 则恢复逐人逐条回复。 |
| `ai.agent.mailbox.merge.quietMs` | integer | 否 | `1500` | 窗口内最后一条消息后安静多久就发车。 |
| `ai.agent.mailbox.merge.maxWaitMs` | integer | 否 | `6000` | 窗口从第一条消息起最多等多久。 |
| `ai.agent.mailbox.merge.maxSenders` | integer | 否 | `5` | 一次合并回复最多容纳的发送者数；超出的人留到下一个窗口。 |
| `ai.agent.mailbox.live` | object | 否 | — | 弹幕模式（ADR 0038）：声明了 liveDanmaku 的直播适配器把一段时间内的弹幕收进窗口后只回一次；只开放只读工具，不出审批卡。 |
| `ai.agent.mailbox.live.mode` | string: `"pick-one"`, `"summary"` | 否 | `"pick-one"` | pick-one：从窗口里挑一条回；summary：概括整个窗口后回一次。 |
| `ai.agent.mailbox.live.windowMs` | integer | 否 | `10000` | 弹幕窗口从第一条弹幕起收集多久。 |
| `ai.agent.mailbox.live.minIntervalMs` | integer | 否 | `15000` | 同一直播间两次弹幕回复的最小间隔。 |
| `ai.agent.mailbox.coalesceWindowMs` | number \| string | 否 | — | — |
| `ai.agent.execSecurity` | string: `"deny"`, `"allowlist"`, `"full"` | 否 | — | Shell 命令安全边界。 |
| `ai.agent.execPreset` | string: `"readonly"`, `"network"`, `"development"`, `"custom"` | 否 | — | 非 full 模式使用的命令白名单预设。 |
| `ai.agent.network` | object | 否 | — | IM 回合的出网权限（web_fetch / web_search 与联网命令）。默认关闭；enabled 开启 HTTPS 出网，allowedDomains 非空时只允许这些域名。未设置 enabled 时兼容旧配置：execPreset: network 视为开启。 |
| `ai.agent.network.enabled` | boolean | 否 | `false` | 是否允许 IM 回合 HTTPS 出网。 |
| `ai.agent.network.allowedDomains` | array&lt;string&gt; | 否 | — | 非空时只允许访问这些域名（含子域名）。 |
| `ai.agent.masterShell` | string: `"off"`, `"isolated"` | 否 | `"off"` | IM 私聊中 master 的 Shell 权限。off：IM 会话不提供 bash；isolated：master 私聊在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、其余命令需审批），宿主无 Docker 时直接失败。 |
| `ai.agent.masterShellApprovalMode` | string: `"ask"`, `"auto"`, `"inherit"` | 否 | `"ask"` | masterShell: isolated 时 master 私聊里需审批的调用怎么批。ask（默认）：弹确认卡给 master；auto：自动审核（审核拒绝时转问 master）；inherit：沿用 execApprovalMode。 |
| `ai.agent.toolBudget` | object | 否 | — | 交互运行时及其同步子任务不设固定轮数和总时长上限，共享配置的 token 额度。步数、时间和续跑设置用于有界任务及旧兼容入口。 |
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
| `ai.agent.toolBudget.progressUpdates` | string: `"off"`, `"private"`, `"all"` | 否 | `"private"` | off 关闭进度；持续交互任务在当前会话报告。private/all 用于选择有界任务的通知范围。 |
| `ai.agent.toolBudget.progressMinIntervalMs` | integer | 否 | `45000` | 两次进度更新的最小间隔（毫秒）。 |
| `ai.agent.toolBudget.progressMaxUpdates` | integer | 否 | `3` | 0 关闭进度。正数仅限制有界任务的更新次数；持续交互任务按配置的间隔报告，不限次数。 |
| `ai.agent.injectionGuard` | object | 否 | — | 注入防护。外部内容（工具结果、网页、文件、子 agent 报告、群聊背景消息）进入回合后，高危动作（执行命令、向其他会话发消息、改配置、定时任务）必须审批；出站回复检查系统提示、密钥与其他会话记忆泄露。 |
| `ai.agent.injectionGuard.confirmHighRisk` | string: `"external_content"`, `"off"` | 否 | `"external_content"` | external_content：读取外部内容后的高危动作一律审批（无人值守回合直接拒绝）；off：关闭。 |
| `ai.agent.injectionGuard.outboundCheck` | string: `"redact"`, `"off"` | 否 | `"redact"` | redact：在回复和外发工具消息中屏蔽泄露的系统提示、密钥和其他会话记忆；off：关闭。 |
| `ai.agent.injectionGuard.trustedOutputTools` | array&lt;string&gt; | 否 | `[]` | 结果不算外部内容的工具。 |
| `ai.agent.toolHardGate` | object | 否 | — | 危险工具硬闸（ADR 0036）。始终开启，独立于 execApprovalMode：成员管理、内容发布、资金、改 Bot 身份类工具（核心名单 + 声明 risk: dangerous 的工具），以及写宿主自身配置 / 依赖 / git 钩子的调用（zhin.config.*、.env*、package.json、锁文件、node_modules/、.git/ 等）没有新鲜的人工批准或 Console 已批准的卡片就不执行，bypass 也不例外；被拒即 fail closed，同一回合不再重试。配置只能更严。 |
| `ai.agent.toolHardGate.dangerousTools` | array&lt;string&gt; | 否 | `[]` | 额外按危险工具处理的工具（本地名或限定名）；不能把核心危险工具调成安全。 |
| `ai.agent.toolHardGate.allowFunds` | boolean | 否 | `false` | 允许资金类工具（红包、转账、付款）。默认关闭；开启后仍需审批。 |
| `ai.agent.toolHardGate.approvalTimeoutMs` | integer | 否 | `300000` | 危险调用等待审批的上限（毫秒），超时即拒绝。 |
| `ai.agent.toolHardGate.maxPendingPerScene` | integer | 否 | `3` | 同一群（场景）同时待审批的卡片上限（ADR 0038）。超出后危险调用直接拒绝、不生成新卡；对已有待审卡的重复请求不计数。 |
| `ai.agent.toolHardGate.imApproval` | object | 否 | — | 硬闸 IM 审批通道（#1013），默认关闭。开启后每张新审批卡片同时投递给 allowlist 审批人，审批人在私聊（或专用审批群）发送 `approve &lt;id&gt;` / `deny &lt;id&gt;` 结算；与 Console 共用审批队列，先到先得。业务群内的消息不能结算卡片，也没有本会话 / 永久授权。 |
| `ai.agent.toolHardGate.imApproval.enabled` | boolean | 否 | `false` | 开启 IM 审批通道。 |
| `ai.agent.toolHardGate.imApproval.approverIds` | array&lt;string&gt; \| object | 否 | `[]` | 审批人的平台用户 id：扁平列表对所有平台生效；对象形式为 平台（adapter 名）→ 用户 id 列表。不在名单里的人不能通过 IM 结算卡片。 |
| `ai.agent.toolHardGate.imApproval.delivery` | string: `"dm"`, `"approver_group"` | 否 | `"dm"` | dm：私聊发给每位审批人；approver_group：发到 approverGroupId，且不能是触发调用的会话。 |
| `ai.agent.toolHardGate.imApproval.approverGroupId` | string | 否 | — | 专用审批群 id，delivery 为 approver_group 时必填；未配置时 IM 通道不可用，只能在 Console 审批。 |
| `ai.agent.reactions` | object | 否 | — | 按会话限制表情回应的频率。模型每轮都可能提出回应，宿主只在距该会话上次已发出的回应满 cooldownMs 且随机掷骰通过 probability 时才发出；计数保存在内存中。 |
| `ai.agent.reactions.cooldownMs` | integer | 否 | `600000` | 同一会话两次已发出回应之间的最小间隔（毫秒）。 |
| `ai.agent.reactions.probability` | number | 否 | `0.35` | 允许发出的回应实际发出的概率；0 表示关闭表情回应。 |
| `ai.agent.usageQuota` | object | 否 | — | 按用户 / 按群的 token 配额与群速率限制。默认全部关闭（0），主人默认不受限；计数保存在内存中。 |
| `ai.agent.usageQuota.windowMs` | integer | 否 | `86400000` | 配额周期（毫秒）。 |
| `ai.agent.usageQuota.perUserTokens` | integer | 否 | `0` | 每个用户每周期可用的 token；0 不限。 |
| `ai.agent.usageQuota.perGroupTokens` | integer | 否 | `0` | 每个群每周期可用的 token；0 不限。 |
| `ai.agent.usageQuota.perGroupRequestsPerMinute` | integer | 否 | `0` | 每个群每分钟可发起的回合数；0 不限。 |
| `ai.agent.usageQuota.exemptOwner` | boolean | 否 | `true` | 主人不受限制。 |
| `ai.agent.execApprovalMode` | string: `"ask"`, `"bypass"`, `"auto"` | 否 | — | 主 Agent 命令的审批策略。 |
| `ai.agent.approval` | object | 否 | — | IM 审批选项。 |
| `ai.agent.approval.adminSelfApprove` | boolean | 否 | `false` | 允许端点层或以上的 zhin admin 在自己的私聊里、主人无法作答时，本人一次性批准策略标为管理员可批的操作（标了 admin_approvable 的工具，如 schedule_add；session 记忆）。默认 false：只有主人能批。敏感文件、Shell 命令、global / platform 记忆、仅限人工与危险工具、无主人的群聊始终不在此列。 |
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
| `ai.agent.modelHarness.services` | object | 否 | — | Exact runtime Service id; native-model entries override that Service default. |
| `ai.agent.modelHarness.services.<key>.defaults` | object | 否 | — | — |
| `ai.agent.modelHarness.services.<key>.defaults.maxIterations` | number \| string | 否 | — | — |
| `ai.agent.modelHarness.services.<key>.defaults.explorationBudget` | number \| string | 否 | — | 连续只读探索调用达到该次数时注入提示；0 关闭 |
| `ai.agent.modelHarness.services.<key>.defaults.explorationGuidance` | boolean \| string | 否 | — | 在系统提示中加入"先规划、限定目标文件"的探索纪律 |
| `ai.agent.modelHarness.services.<key>.defaults.iterationExtension` | number \| string | 否 | — | 每次有进展时延长的步数（覆盖 toolBudget.extendBy） |
| `ai.agent.modelHarness.services.<key>.defaults.maxTotalIterations` | number \| string | 否 | — | 单段回合的硬步数上限（覆盖 toolBudget.maxTotalIterations） |
| `ai.agent.modelHarness.services.<key>.defaults.emptyReplyRetries` | number \| string | 否 | — | 空回复（无文本且无工具调用）时额外重试次数；默认 0 |
| `ai.agent.modelHarness.services.<key>.defaults.requestTimeoutMs` | number \| string | 否 | — | 单次模型请求超时（毫秒）；0 关闭 |
| `ai.agent.modelHarness.services.<key>.models` | object | 否 | — | — |
| `ai.agent.modelHarness.services.<key>.models.<key>.maxIterations` | number \| string | 否 | — | — |
| `ai.agent.modelHarness.services.<key>.models.<key>.explorationBudget` | number \| string | 否 | — | 连续只读探索调用达到该次数时注入提示；0 关闭 |
| `ai.agent.modelHarness.services.<key>.models.<key>.explorationGuidance` | boolean \| string | 否 | — | 在系统提示中加入"先规划、限定目标文件"的探索纪律 |
| `ai.agent.modelHarness.services.<key>.models.<key>.iterationExtension` | number \| string | 否 | — | 每次有进展时延长的步数（覆盖 toolBudget.extendBy） |
| `ai.agent.modelHarness.services.<key>.models.<key>.maxTotalIterations` | number \| string | 否 | — | 单段回合的硬步数上限（覆盖 toolBudget.maxTotalIterations） |
| `ai.agent.modelHarness.services.<key>.models.<key>.emptyReplyRetries` | number \| string | 否 | — | 空回复（无文本且无工具调用）时额外重试次数；默认 0 |
| `ai.agent.modelHarness.services.<key>.models.<key>.requestTimeoutMs` | number \| string | 否 | — | 单次模型请求超时（毫秒）；0 关闭 |
| `ai.agent.providerResilience` | object | 否 | — | 固定模型韧性：重试 / 退避 / 超时（见 ProviderResilienceConfig） |
| `ai.agent.providerResilience.maxRetries` | number \| string | 否 | — | Retries per model after the first attempt. Default 2. `0` disables retry. |
| `ai.agent.providerResilience.baseDelayMs` | number \| string | 否 | — | First backoff delay in ms; doubles each retry. Default 1000. |
| `ai.agent.providerResilience.maxDelayMs` | number \| string | 否 | — | Upper bound for one backoff delay in ms. Default 10000. |
| `ai.agent.providerResilience.maxRetryAfterMs` | number \| string | 否 | — | A `Retry-After` longer than this stops retry. Default 30000. |
| `ai.agent.providerResilience.requestTimeoutMs` | number \| string | 否 | — | Per-attempt timeout in ms (whole streamed completion). Default 180000. `0` disables. |
| `ai.agent.providerResilience.emptyReplyRetries` | number \| string | 否 | — | Extra attempts when the model returns neither text nor tool calls (or a tool call without a name). Default 0: the reply is passed through unchanged. Quirk presets (see model harness) raise this for models known to emit spurious empty replies. |
| `ai.agent.deferredTools` | object | 否 | — | 工具 schema 按需加载 |
| `ai.agent.deferredTools.maxLoadedPerSession` | number \| string | 否 | — | — |
| `ai.agent.deferredTools.discoverTopK` | number \| string | 否 | — | — |
| `ai.agent.deferredTools.alwaysLoadedTools` | array&lt;string&gt; | 否 | — | 额外常驻工具；在当前场景档（群聊、私聊、主人私聊）的常驻集合基础上追加 |
| `ai.agent.deferredTools.alwaysLoadedMode` | string | 否 | — | `extend`（默认）追加到内置常驻集合；`replace` 完全替换 |
| `ai.agent.deferredTools.mcpServers` | object | 否 | — | — |
| `ai.agent.deferredTools.mcpServers.<key>.alwaysLoaded` | array&lt;string&gt; | 否 | — | — |
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
| `ai.agent.maxSubagentIterations` | number \| string | 否 | — | — |
| `ai.agent.skillInstructionMaxChars` | number \| string | 否 | — | — |
| `ai.agent.promptTrace` | boolean \| string | 否 | — | — |
| `ai.agent.promptTraceVerbose` | boolean \| string | 否 | — | — |
| `ai.agent.recordRequestBodies` | boolean | 否 | — | — |
| `ai.agent.promptCache` | boolean \| string | 否 | — | — |
| `ai.agent.promptCacheKeyPrefix` | string | 否 | — | — |
| `ai.agent.gitStatus` | boolean \| string | 否 | — | §1 Runtime 注入单行 git 状态摘要（非 git 仓库自动跳过） |
| `ai.agent.contextPaths` | array&lt;string&gt; | 否 | — | 追加的上下文文件路径（支持 ~ 与相对路径；默认另加载 ~/.config/zhin/AGENTS.md 等全局路径） |
| `ai.agent.systemPromptMaxChars` | number \| string | 否 | — | 系统提示词总字符上限；按 retention/order 让出预算，required 内容放不下则失败。 |
| `ai.agent.thinkingPreview` | boolean \| string | 否 | — | Activity feedback 展示 LLM 实际 thinking 内容（截断），而非静态 "思考中..."。 |
| `ai.agent.thinkingPreviewMaxLength` | number \| string | 否 | — | thinkingPreview 展示的最大字符数。 |
| `ai.enabled` | boolean \| string | 否 | — | — |
| `ai.agents` | object \| null | 否 | — | Agent authority and display metadata. Model selection belongs to runtime Profile purposes. |
| `ai.agents.<key>.mcpServers` | array \| null | 否 | — | — |
| `ai.agents.<key>.nickname` | string | 否 | — | Fallback nickname when the Endpoint does not provide account profile data. |
| `ai.sessions` | object \| null | 否 | — | — |
| `ai.sessions.maxHistory` | number \| string | 否 | — | 最大历史消息数（数据库模式默认200，内存模式默认100） |
| `ai.sessions.expireMs` | number \| string | 否 | — | 会话过期时间（毫秒，数据库模式默认7天，内存模式默认24小时） |
| `ai.sessions.useDatabase` | boolean \| string | 否 | — | 是否使用数据库持久化存储（默认 true） |
| `ai.sessions.coldStartMaxMessages` | number \| string | 否 | — | 无摘要时冷启动最多条数（默认 50） |
| `ai.sessions.coldStartMaxAgeMs` | number \| string | 否 | — | 冷启动时间窗（毫秒，默认 24h） |
| `ai.sessions.sessionIdleArchiveMs` | number \| string | 否 | — | 空闲后自动归档 active 会话（毫秒，默认 7 天；0=关闭） |
| `ai.context` | object \| null | 否 | — | — |
| `ai.context.enabled` | boolean \| string | 否 | — | 是否启用消息记录（默认 true） |
| `ai.context.maxRecentMessages` | number \| string | 否 | — | 历史消息条数上限（默认 100）；与 historyTokens 取先到者 |
| `ai.context.historyTokens` | number \| string \| object | 否 | — | 每轮发给模型的历史 token 预算：数字对所有场景生效，也可写 { group, private, masterPrivate }；默认群聊 8000、普通私聊 12000、主人私聊 24000；0 = 不按 token 限制 |
| `ai.context.historyTokens.group` | number \| string | 否 | — | 群聊 / 频道（默认 8000） |
| `ai.context.historyTokens.private` | number \| string | 否 | — | 普通私聊（默认 12000） |
| `ai.context.historyTokens.masterPrivate` | number \| string | 否 | — | 主人私聊（默认 24000） |
| `ai.context.summaryThreshold` | number \| string | 否 | — | 触发总结的消息数量阈值（默认 50） |
| `ai.context.keepAfterSummary` | number \| string | 否 | — | 总结后保留的消息数量（默认 10） |
| `ai.context.maxContextTokens` | number \| string | 否 | — | 上下文最大 token 估算（默认 4000） |
| `ai.context.summaryPrompt` | string | 否 | — | 自定义总结提示词 |
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
| `ai.multimodal.perception.kinds` | array&lt;string&gt; | 否 | — | Kinds to describe. Default `['image']`; `file` covers PDFs only. |
| `ai.multimodal.perception.maxChars` | number \| string | 否 | — | Description length cap in characters. Default 800. |
| `ai.multimodal.perception.timeoutMs` | number \| string | 否 | — | Per-attempt timeout in ms. Default 30000. |
| `ai.multimodal.perception.maxItemsPerTurn` | number \| string | 否 | — | Media described per turn; the rest keep the placeholder. Default 4. |
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
| `ai.trigger.ambient.quietMs` | number \| string | 否 | — | 群安静多久后才判断一次（毫秒，默认 4000） |
| `ai.trigger.ambient.cooldownMs` | number \| string | 否 | — | 两次主动插话之间的最短间隔（毫秒，默认 120000）；对话进行中不受限制 |
| `ai.trigger.ambient.maxPerHour` | number \| string | 否 | — | 每个群每小时最多主动插话次数（默认 3）；对话进行中不计入 |
| `ai.trigger.ambient.conversationWindowMs` | number \| string | 否 | — | 机器人说话后，这段时间内算作对话进行中：群友接它的话只由判断模型决定，不受冷却和每小时次数限制（毫秒，默认 180000） |
| `ai.trigger.ambient.judgeIntervalMs` | number \| string | 否 | — | 没在对话时，同一个群至少隔这么久才判断一次（毫秒，默认 30000），节省判断模型的额度；窗口内的消息顺延到窗口结束再判，不会丢 |
| `ai.trigger.ambient.minConfidence` | number \| string | 否 | — | 判断模型置信度门槛 0..1（默认 0.7） |
| `ai.trigger.ambient.mode` | string: `"active"`, `"shadow"` | 否 | — | shadow 只记录判断结果、不回复（默认 active） |
| `ai.trigger.sceneEvents` | object | 否 | — | 状态感知：禁言/解禁、入群申请、成员进出、公告变更、戳 Bot 等高优先社交事件独立唤醒一次回合（不必等下一条人话）；表情回应、名片/头衔变更等低优先事件不单独唤醒，只在下一轮 [Scene events] 摘要里出现。Bot 不能发言时只更新会话画像，不调用模型。 |
| `ai.trigger.sceneEvents.conversations` | array&lt;string&gt; | 否 | — | 允许被社交事件唤醒的群/频道，格式 platform:sceneId；* 表示所有群。缺省沿用 ai.trigger.ambient.conversations（都没配则不唤醒） |
| `ai.trigger.sceneEvents.coalesceMs` | number \| string | 否 | — | 同一场景的合并窗口（毫秒，限定 3000～5000，默认 4000） |
| `ai.trigger.sceneEvents.minIntervalMs` | number \| string | 否 | — | 同一场景两次唤醒的最短间隔（毫秒，默认 15000）；未到时间的批次顺延，不丢 |
| `ai.usage` | object \| null | 否 | — | 结构化用量存储（SQLite、MySQL、PostgreSQL）；独立于日志级别，不保存正文或工具参数。 |
| `ai.usage.retentionDays` | integer \| string | 否 | `30` | 用量明细保留天数，正整数，默认 30 天；按回合结束时间清理，子调用与所属回合一起删除。 |
| `ai.audit` | object \| null | 否 | — | 决策审计 ai_decision_events（ADR 0036）：每次进不进模型、说不说话、调不调工具都记一行，在 Console「机器人状态 → 决策回放」查看与导出；不保存正文、提示词或密钥。 |
| `ai.audit.retentionDays` | integer \| string | 否 | `14` | 决策审计保留天数，正整数，默认 14 天；启动时与之后每小时按事件时间清理过期行。 |
| `ai.imageStorage` | object | 否 | — | Optional public R2 storage for generated images. Bucket access and lifecycle are managed by the operator. |
| `ai.imageStorage.accountId` | string | 是 | — | — |
| `ai.imageStorage.bucket` | string | 是 | — | — |
| `ai.imageStorage.accessKeyId` | string | 是 | — | — |
| `ai.imageStorage.secretAccessKey` | string | 是 | — | — |
| `ai.imageStorage.publicBaseUrl` | string | 是 | — | Public HTTPS base URL; not the S3 upload endpoint. |
| `ai.imageStorage.prefix` | string | 是 | — | Object directory ending in /; must be covered by the bucket lifecycle. |
| `ai.personalPrincipals` | object | 否 | — | Administrator mapping from authenticated Console principal ids to exact IM owners; never inferred from client input. |
| `menuKeyword` | string \| `false` | 否 | — | 内置指令菜单关键词；默认 菜单，false 或空字符串关闭菜单。 |
| `commandSuggestion` | boolean \| object | 否 | — | 未命中但与已注册指令名/别名高度相似的消息（私聊、@机器人或带指令前缀）直接回复「没有这个指令，你是不是想用：…」，不交给 AI；false 关闭。 |
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
| `a2a` | object | 否 | — | A2A Agent Card、远程执行与跨进程 Mailbox 传输。 |
| `a2a.enabled` | boolean \| string | 否 | — | — |
| `a2a.path` | string \| null | 否 | — | — |
| `a2a.token` | string \| null | 否 | — | — |
| `a2a.publicUrl` | string \| null | 否 | — | — |
| `a2a.mailbox` | object \| null | 否 | — | 跨进程 A2A Mailbox 传输（携带签名 Mail、Authority 与 Budget，ADR 0048 §3.6）。 |
| `a2a.mailbox.enabled` | boolean \| string | 否 | — | — |
| `a2a.mailbox.path` | string | 否 | — | Inbound HTTP route path (defaults to `/a2a/mailbox`). |
| `a2a.mailbox.secret` | string | 否 | — | — |
| `a2a.mailbox.maxBodyBytes` | number \| string | 否 | — | — |
| `a2a.mailbox.peers` | array&lt;object&gt; | 否 | — | — |
| `a2a.mailbox.peers[].actor` | string | 是 | — | — |
| `a2a.mailbox.peers[].url` | string | 是 | — | — |
| `a2a.mailbox.peers[].token` | string | 否 | — | — |
| `a2a.mailbox.peers[].secret` | string | 否 | — | — |
| `a2a.mailbox.peers[].timeoutMs` | number \| string | 否 | — | — |
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
| `assistant` | object | 否 | — | 调度任务、事件入口和失败通知。 |
| `assistant.enabled` | boolean \| string | 否 | — | 启用统一 JobStore（默认 false，Stable 行为不变） |
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
| `locale` | string: `"zh-CN"`, `"en"` | 否 | — | 未设置个人偏好时使用的语言；未配置时使用简体中文，语言与时区独立。 |
| `features` | object | 否 | — | 插件配置块之外的功能配置（ADR 0055）：群内自助。修改后需重启。 |
| `features.selfService` | object | 否 | — | 聊天角色 admin 在聊天中使用的 `功能` / `feature` 与 `角色` / `role` 命令（ADR 0055 / 0056），默认关闭。平台群主 / 管理员不是 zhin 角色，需要显式授予 admin。 |
| `features.selfService.enabled` | boolean | 否 | `false` | 注册群内功能自助与角色命令。 |

## 独立 AI 导入提案

`ai.plan.yml` 仅供显式预览、应用和导出，不是启动配置，不会自动加载或覆盖运行时图。

[`packages/im/ai/provider-plan.schema.json`](https://github.com/zhinjs/zhin/blob/main/packages/im/ai/provider-plan.schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `version` | `1` | 是 | — | — |
| `services` | object | 否 | — | — |
| `services.<key>.driver` | string \| object | 是 | — | — |
| `services.<key>.label` | string | 否 | — | — |
| `services.<key>.options` | object | 否 | — | — |
| `services.<key>.models` | object | 否 | — | — |
| `services.<key>.models.<key>.id` | string | 是 | — | — |
| `services.<key>.models.<key>.kinds` | array&lt;string: `"language"`, `"decision"`, `"image"`&gt; | 是 | — | — |
| `services.<key>.models.<key>.protocol` | string | 是 | — | — |
| `services.<key>.models.<key>.input` | array&lt;string: `"text"`, `"image"`, `"audio"`, `"video"`, `"file"`&gt; | 否 | — | — |
| `services.<key>.models.<key>.streaming` | boolean | 否 | — | — |
| `services.<key>.models.<key>.toolCalling` | boolean | 否 | — | — |
| `services.<key>.models.<key>.thinking` | boolean | 否 | — | — |
| `services.<key>.models.<key>.contextWindow` | integer | 否 | — | — |
| `services.<key>.models.<key>.maxOutputTokens` | integer | 否 | — | — |
| `accounts` | object | 否 | — | — |
| `accounts.<key>.service` | string | 是 | — | — |
| `accounts.<key>.label` | string | 否 | — | — |
| `accounts.<key>.auth` | object \| object \| object | 是 | — | — |
| `profiles` | object | 否 | — | — |
| `profiles.<key>.account` | string | 是 | — | — |
| `profiles.<key>.model` | string | 是 | — | — |
| `profiles.<key>.label` | string | 否 | — | — |
| `profiles.<key>.parameters` | object | 否 | — | — |
| `purposes` | object | 否 | — | — |
| `purposes.chat` | object \| null | 否 | — | — |
| `purposes.summary` | object \| null | 否 | — | — |
| `purposes.ambient` | object \| null | 否 | — | — |
| `purposes.image` | object \| null | 否 | — | — |
| `purposes.perception` | object \| null | 否 | — | — |
| `purposes.decisions` | object | 否 | — | — |
| `purposes.decisions.skills` | object \| null | 否 | — | — |
| `purposes.decisions.tools` | object \| null | 否 | — | — |
| `purposes.decisions.memory` | object \| null | 否 | — | — |
| `purposes.decisions.agents` | object \| null | 否 | — | — |
| `purposes.decisions.approval` | object \| null | 否 | — | — |
| `purposes.decisions.ambient` | object \| null | 否 | — | — |
| `purposes.agents` | object | 否 | — | — |
| `purposes.adapters` | object | 否 | — | — |
| `purposes.endpoints` | object | 否 | — | — |
| `purposes.scenes` | object | 否 | — | — |
| `remove` | object | 否 | — | — |
| `remove.services` | array&lt;string&gt; | 否 | — | — |
| `remove.accounts` | array&lt;string&gt; | 否 | — | — |
| `remove.profiles` | array&lt;string&gt; | 否 | — | — |

## 插件实例字段

以下字段通过 Runtime 的统一读取器从 trusted 插件的 `config: Schema.object(...)` 声明或 `schema.json` 生成；isolated 插件只能使用 `schema.json`。顶层 `<name>` 是默认 instanceKey；`plugins.<name>` 仅保存包引用。

### bilibili

[`plugins/adapters/bilibili/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/bilibili/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `bilibili.apiBaseUrl` | string | 否 | `"https://api.bilibili.com"` | — |
| `bilibili.pollIntervalSec` | number | 否 | `60` | 轮询间隔（秒），最小 60，实际会加 0–20% 随机抖动 |
| `bilibili.sendMode` | string: `"review"`, `"off"` | 否 | `"review"` | 出站模式：review=AI 回复只进草稿队列，master 用 bili-draft send &lt;id&gt; 审批后才发出（默认）；off=禁止出站。不提供自动直发 |
| `bilibili.minSendIntervalSec` | number | 否 | `30` | 审批后两次真实发送的最小间隔（秒），最小 10；不足时拒绝发送，不排队 |
| `bilibili.notifications` | array&lt;string: `"reply"`, `"at"`&gt; | 否 | `[]` | 额外轮询的通知：reply=回复我的，at=@我的（需要 Cookie；收视频评论，配置了 dynamics / articles 时也收动态 / 专栏评论）。默认不开 |
| `bilibili.notificationScope` | string: `"whitelist"`, `"all"` | 否 | `"whitelist"` | 通知入站范围：whitelist=只收 videos / dynamics / articles 白名单下的通知（默认）；all=所有视频评论通知，以及配置了 dynamics / articles 时对应种类的全部评论通知 |
| `bilibili.dataDir` | string | 否 | `"data/bilibili"` | 本地数据目录：待审草稿与扫码登录凭据存在 &lt;dataDir&gt;/&lt;endpoint id&gt;/ 下（相对进程工作目录），重启不丢。不要放进仓库 |
| `bilibili.notify` | object | 否 | — | 有新草稿或登录失效时，主动发消息提醒到这个聊天会话（通常是你和机器人的私聊）。不填则只在 Console「评论审批」页和日志里看到 |
| `bilibili.notify.adapter` | string | 是 | — | 适配器名，如 icqq、telegram |
| `bilibili.notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `bilibili.notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型 |
| `bilibili.notify.id` | string \| number | 是 | — | 会话 id：私聊填你的账号，群聊填群号 |
| `bilibili.videos` | array&lt;string \| number&gt; | 否 | — | 白名单视频：BV 号或 av 号。只轮询这些视频的评论，不做全站搜索 |
| `bilibili.dynamics` | array&lt;string&gt; | 否 | — | 白名单动态：动态 id（t.bilibili.com/&lt;id&gt; 或 bilibili.com/opus/&lt;id&gt; 里的数字，请写成字符串）。启动时经动态详情解析出评论区（图文动态 type=11 / 文字动态 type=17），无法解析的动态会跳过。不做全站搜索 |
| `bilibili.articles` | array&lt;string \| number&gt; | 否 | — | 白名单专栏：cv 号（cv123 或 123），评论区 type=12。不做全站搜索 |
| `bilibili.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `bilibili.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `bilibili.endpoints[].id` | string | 是 | — | Endpoint 名称（本地标识，不是 B 站账号） |
| `bilibili.endpoints[].sessdata` | string | 否 | — | Cookie SESSDATA（以你的账号身份操作；请用 ${BILIBILI_SESSDATA} 注入，切勿写入仓库） |
| `bilibili.endpoints[].biliJct` | string | 否 | — | Cookie bili_jct（csrf token；请用 ${BILIBILI_BILI_JCT} 注入） |
| `bilibili.endpoints[].videos` | array&lt;string \| number&gt; | 否 | — | 白名单视频：BV 号或 av 号。只轮询这些视频的评论，不做全站搜索 |
| `bilibili.endpoints[].dynamics` | array&lt;string&gt; | 否 | — | 白名单动态：动态 id（t.bilibili.com/&lt;id&gt; 或 bilibili.com/opus/&lt;id&gt; 里的数字，请写成字符串）。启动时经动态详情解析出评论区（图文动态 type=11 / 文字动态 type=17），无法解析的动态会跳过。不做全站搜索 |
| `bilibili.endpoints[].articles` | array&lt;string \| number&gt; | 否 | — | 白名单专栏：cv 号（cv123 或 123），评论区 type=12。不做全站搜索 |
| `bilibili.endpoints[].pollIntervalSec` | number | 否 | `60` | 轮询间隔（秒），最小 60，实际会加 0–20% 随机抖动 |
| `bilibili.endpoints[].sendMode` | string: `"review"`, `"off"` | 否 | `"review"` | 出站模式：review=AI 回复只进草稿队列，master 用 bili-draft send &lt;id&gt; 审批后才发出（默认）；off=禁止出站。不提供自动直发 |
| `bilibili.endpoints[].minSendIntervalSec` | number | 否 | `30` | 审批后两次真实发送的最小间隔（秒），最小 10；不足时拒绝发送，不排队 |
| `bilibili.endpoints[].notifications` | array&lt;string: `"reply"`, `"at"`&gt; | 否 | `[]` | 额外轮询的通知：reply=回复我的，at=@我的（需要 Cookie；收视频评论，配置了 dynamics / articles 时也收动态 / 专栏评论）。默认不开 |
| `bilibili.endpoints[].notificationScope` | string: `"whitelist"`, `"all"` | 否 | `"whitelist"` | 通知入站范围：whitelist=只收 videos / dynamics / articles 白名单下的通知（默认）；all=所有视频评论通知，以及配置了 dynamics / articles 时对应种类的全部评论通知 |
| `bilibili.endpoints[].dataDir` | string | 否 | `"data/bilibili"` | 本地数据目录：待审草稿与扫码登录凭据存在 &lt;dataDir&gt;/&lt;endpoint id&gt;/ 下（相对进程工作目录），重启不丢。不要放进仓库 |
| `bilibili.endpoints[].notify` | object | 否 | — | 有新草稿或登录失效时，主动发消息提醒到这个聊天会话（通常是你和机器人的私聊）。不填则只在 Console「评论审批」页和日志里看到 |
| `bilibili.endpoints[].notify.adapter` | string | 是 | — | 适配器名，如 icqq、telegram |
| `bilibili.endpoints[].notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `bilibili.endpoints[].notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型 |
| `bilibili.endpoints[].notify.id` | string \| number | 是 | — | 会话 id：私聊填你的账号，群聊填群号 |
| `bilibili.endpoints[].apiBaseUrl` | string | 否 | `"https://api.bilibili.com"` | — |
| `bilibili.endpoints[].commandPrefix` | string | 否 | — | — |
| `bilibili.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `bilibili.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `bilibili.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `bilibili.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `bilibili.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `bilibili.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `bilibili.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `bilibili.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `bilibili.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `bilibili.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `bilibili.profile` | object | 否 | — | 账号资料兜底 |
| `bilibili.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `bilibili.profile.age` | integer \| null | 否 | — | — |
| `bilibili.profile.birthday` | string \| null | 否 | — | — |
| `bilibili.profile.signature` | string \| null | 否 | — | — |
| `bilibili.profile.avatar` | string \| null | 否 | — | — |
| `bilibili.profile.interests` | array \| null | 否 | — | — |
| `bilibili.profile.bio` | string \| null | 否 | — | — |

### bilibili-live

[`plugins/adapters/bilibili-live/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/bilibili-live/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `bilibili-live.roomId` | string \| number | 否 | — | 直播间号（短号或长号都可以）；只填你自己的直播间 |
| `bilibili-live.sendMode` | string: `"direct"`, `"off"` | 否 | `"direct"` | 出站模式：direct=回合结束直接发弹幕（默认，需登录）；off=只听不说 |
| `bilibili-live.maxLength` | number | 否 | `20` | 单条弹幕最多字符数（默认 20，直播等级高的账号可调大） |
| `bilibili-live.maxChunks` | number | 否 | `2` | 一次回复最多拆成几条弹幕（默认 2），放不下的截断 |
| `bilibili-live.minSendIntervalSec` | number | 否 | `5` | 两次回复的最小间隔（秒），最小 2；不足时拒绝发送，不排队 |
| `bilibili-live.apiBaseUrl` | string | 否 | `"https://api.bilibili.com"` | — |
| `bilibili-live.liveApiBaseUrl` | string | 否 | `"https://api.live.bilibili.com"` | — |
| `bilibili-live.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `bilibili-live.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `bilibili-live.endpoints[].id` | string | 是 | — | Endpoint 名称（本地标识，不是 B 站账号） |
| `bilibili-live.endpoints[].sessdata` | string | 否 | — | Cookie SESSDATA（以你的账号身份发弹幕；请用 ${BILIBILI_SESSDATA} 注入，切勿写入仓库）。不填则匿名只读 |
| `bilibili-live.endpoints[].biliJct` | string | 否 | — | Cookie bili_jct（csrf token，发弹幕需要；请用 ${BILIBILI_BILI_JCT} 注入） |
| `bilibili-live.endpoints[].buvid3` | string | 否 | — | Cookie buvid3（可选；不填时启动时向平台申请） |
| `bilibili-live.endpoints[].roomId` | string \| number | 否 | — | 直播间号（短号或长号都可以）；只填你自己的直播间 |
| `bilibili-live.endpoints[].sendMode` | string: `"direct"`, `"off"` | 否 | `"direct"` | 出站模式：direct=回合结束直接发弹幕（默认，需登录）；off=只听不说 |
| `bilibili-live.endpoints[].maxLength` | number | 否 | `20` | 单条弹幕最多字符数（默认 20，直播等级高的账号可调大） |
| `bilibili-live.endpoints[].maxChunks` | number | 否 | `2` | 一次回复最多拆成几条弹幕（默认 2），放不下的截断 |
| `bilibili-live.endpoints[].minSendIntervalSec` | number | 否 | `5` | 两次回复的最小间隔（秒），最小 2；不足时拒绝发送，不排队 |
| `bilibili-live.endpoints[].apiBaseUrl` | string | 否 | `"https://api.bilibili.com"` | — |
| `bilibili-live.endpoints[].liveApiBaseUrl` | string | 否 | `"https://api.live.bilibili.com"` | — |
| `bilibili-live.endpoints[].commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `bilibili-live.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `bilibili-live.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `bilibili-live.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `bilibili-live.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `bilibili-live.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `bilibili-live.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `bilibili-live.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `bilibili-live.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `bilibili-live.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `bilibili-live.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `bilibili-live.profile` | object | 否 | — | 账号资料兜底 |
| `bilibili-live.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `bilibili-live.profile.age` | integer \| null | 否 | — | — |
| `bilibili-live.profile.birthday` | string \| null | 否 | — | — |
| `bilibili-live.profile.signature` | string \| null | 否 | — | — |
| `bilibili-live.profile.avatar` | string \| null | 否 | — | — |
| `bilibili-live.profile.interests` | array \| null | 否 | — | — |
| `bilibili-live.profile.bio` | string \| null | 否 | — | — |

### dingtalk

[`plugins/adapters/dingtalk/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/dingtalk/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `dingtalk.apiBaseUrl` | string | 否 | `"https://oapi.dingtalk.com"` | — |
| `dingtalk.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
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
| `dingtalk.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `dingtalk.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `dingtalk.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `dingtalk.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `dingtalk.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `dingtalk.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `dingtalk.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `dingtalk.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `dingtalk.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `dingtalk.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `dingtalk.mode` | string: `"webhook"`, `"stream"` | 否 | `"webhook"` | — |
| `dingtalk.cardTemplateId` | string | 否 | — | Stream interactive card template ID |
| `dingtalk.cardButtonCount` | integer | 否 | `2` | Fixed button count in the card template |
| `dingtalk.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `dingtalk.profile` | object | 否 | — | 账号资料兜底 |
| `dingtalk.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `dingtalk.profile.age` | integer \| null | 否 | — | — |
| `dingtalk.profile.birthday` | string \| null | 否 | — | — |
| `dingtalk.profile.signature` | string \| null | 否 | — | — |
| `dingtalk.profile.avatar` | string \| null | 否 | — | — |
| `dingtalk.profile.interests` | array \| null | 否 | — | — |
| `dingtalk.profile.bio` | string \| null | 否 | — | — |

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
| `discord.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项定义一个 endpoint，id/token 必填，其余字段覆盖实例默认值 |
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
| `discord.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `discord.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `discord.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `discord.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `discord.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `discord.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `discord.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `discord.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `discord.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `discord.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `discord.gatewayFaultProxyUrl` | string | 否 | — | Isolated acceptance only: loopback Gateway fault proxy; REST unchanged. |
| `discord.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `discord.profile` | object | 否 | — | 账号资料兜底 |
| `discord.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `discord.profile.age` | integer \| null | 否 | — | — |
| `discord.profile.birthday` | string \| null | 否 | — | — |
| `discord.profile.signature` | string \| null | 否 | — | — |
| `discord.profile.avatar` | string \| null | 否 | — | — |
| `discord.profile.interests` | array \| null | 否 | — | — |
| `discord.profile.bio` | string \| null | 否 | — | — |

### douyin-live

[`plugins/adapters/douyin-live/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/douyin-live/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `douyin-live.sendMode` | string: `"off"`, `"direct"` | 否 | `"off"` | 出站模式：off=只听不说（默认）；direct=尚未实现，发送返回 not_implemented |
| `douyin-live.maxLength` | number | 否 | `50` | 单条弹幕最多字符数（默认 50，为后续 direct 发送预留） |
| `douyin-live.maxChunks` | number | 否 | `2` | 一次回复最多拆成几条弹幕（默认 2） |
| `douyin-live.minSendIntervalSec` | number | 否 | `5` | 两次回复的最小间隔（秒），最小 2 |
| `douyin-live.signerUrl` | string | 否 | — | 可选：外部签名服务（GET ?stub=&lt;X-MS-STUB&gt; 返回 signature）。本包不内置平台签名脚本；不填时不带签名连接，平台可能拒绝 |
| `douyin-live.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `douyin-live.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `douyin-live.endpoints[].id` | string | 是 | — | Endpoint 名称（本地标识，不是抖音账号） |
| `douyin-live.endpoints[].cookie` | string | 否 | — | 浏览器 Cookie 整串（请用 ${DOUYIN_LIVE_COOKIE} 注入，切勿写入仓库）。不填时启动时申请游客 ttwid |
| `douyin-live.endpoints[].roomId` | string \| integer | 是 | — | 直播间 web_rid（live.douyin.com/ 后面的数字）；只填你自己的直播间 |
| `douyin-live.endpoints[].sendMode` | string: `"off"`, `"direct"` | 否 | `"off"` | 出站模式：off=只听不说（默认）；direct=尚未实现，发送返回 not_implemented |
| `douyin-live.endpoints[].maxLength` | number | 否 | `50` | 单条弹幕最多字符数（默认 50，为后续 direct 发送预留） |
| `douyin-live.endpoints[].maxChunks` | number | 否 | `2` | 一次回复最多拆成几条弹幕（默认 2） |
| `douyin-live.endpoints[].minSendIntervalSec` | number | 否 | `5` | 两次回复的最小间隔（秒），最小 2 |
| `douyin-live.endpoints[].signerUrl` | string | 否 | — | 可选：外部签名服务（GET ?stub=&lt;X-MS-STUB&gt; 返回 signature）。本包不内置平台签名脚本；不填时不带签名连接，平台可能拒绝 |
| `douyin-live.endpoints[].commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `douyin-live.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `douyin-live.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `douyin-live.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `douyin-live.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `douyin-live.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `douyin-live.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `douyin-live.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `douyin-live.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `douyin-live.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `douyin-live.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `douyin-live.profile` | object | 否 | — | 账号资料兜底 |
| `douyin-live.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `douyin-live.profile.age` | integer \| null | 否 | — | — |
| `douyin-live.profile.birthday` | string \| null | 否 | — | — |
| `douyin-live.profile.signature` | string \| null | 否 | — | — |
| `douyin-live.profile.avatar` | string \| null | 否 | — | — |
| `douyin-live.profile.interests` | array \| null | 否 | — | — |
| `douyin-live.profile.bio` | string \| null | 否 | — | — |

### email

[`plugins/adapters/email/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/email/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `email.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
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
| `email.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `email.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `email.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `email.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `email.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `email.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `email.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `email.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `email.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `email.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `email.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `email.profile` | object | 否 | — | 账号资料兜底 |
| `email.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `email.profile.age` | integer \| null | 否 | — | — |
| `email.profile.birthday` | string \| null | 否 | — | — |
| `email.profile.signature` | string \| null | 否 | — | — |
| `email.profile.avatar` | string \| null | 否 | — | — |
| `email.profile.interests` | array \| null | 否 | — | — |
| `email.profile.bio` | string \| null | 否 | — | — |

### github

[`plugins/adapters/github/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/github/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `github.host` | string | 否 | — | GitHub Enterprise hostname (default github.com) |
| `github.webhook_path` | string | 否 | `"/github/webhook"` | — |
| `github.auto_reply_repos` | array&lt;string&gt; | 否 | — | Repos whose Issue/PR comments auto-trigger AI without @bot |
| `github.bot_login` | string | 否 | — | Override App bot login (default {slug}[bot]) |
| `github.workspace_root` | string | 否 | — | Managed git workspace root |
| `github.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint |
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
| `github.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `github.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `github.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `github.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `github.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `github.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `github.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `github.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `github.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `github.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `github.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `github.profile` | object | 否 | — | 账号资料兜底 |
| `github.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `github.profile.age` | integer \| null | 否 | — | — |
| `github.profile.birthday` | string \| null | 否 | — | — |
| `github.profile.signature` | string \| null | 否 | — | — |
| `github.profile.avatar` | string \| null | 否 | — | — |
| `github.profile.interests` | array \| null | 否 | — | — |
| `github.profile.bio` | string \| null | 否 | — | — |

### icqq

[`plugins/adapters/icqq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/icqq/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
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
| `icqq.endpoints[].notify` | object | 否 | — | 掉线/登录失败时通过另一个适配器实例给 master 发通知（adapter/endpoint/kind/id 指向实际会话） |
| `icqq.endpoints[].notify.adapter` | string | 是 | — | 通知使用的适配器类型，如 qq / icqq |
| `icqq.endpoints[].notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `icqq.endpoints[].notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型，默认 private |
| `icqq.endpoints[].notify.id` | string \| number | 是 | — | master 在该平台上的会话 id（QQ 官方为 openid，ICQQ 为 QQ 号） |
| `icqq.endpoints[].notify.parent` | object | 否 | — | 可选的父频道/群容器 |
| `icqq.endpoints[].notify.parent.kind` | string: `"private"`, `"group"`, `"channel"` | 是 | — | — |
| `icqq.endpoints[].notify.parent.id` | string \| number | 是 | — | — |
| `icqq.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `icqq.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `icqq.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `icqq.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `icqq.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `icqq.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `icqq.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `icqq.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `icqq.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `icqq.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀）。endpoints[i] 可逐项覆盖 |
| `icqq.notify` | object | 否 | — | 掉线/登录失败时通过另一个适配器实例给 master 发通知（adapter/endpoint/kind/id 指向实际会话） |
| `icqq.notify.adapter` | string | 是 | — | 通知使用的适配器类型，如 qq / icqq |
| `icqq.notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `icqq.notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型，默认 private |
| `icqq.notify.id` | string \| number | 是 | — | master 在该平台上的会话 id（QQ 官方为 openid，ICQQ 为 QQ 号） |
| `icqq.notify.parent` | object | 否 | — | 可选的父频道/群容器 |
| `icqq.notify.parent.kind` | string: `"private"`, `"group"`, `"channel"` | 是 | — | — |
| `icqq.notify.parent.id` | string \| number | 是 | — | — |
| `icqq.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `icqq.profile` | object | 否 | — | 账号资料兜底 |
| `icqq.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `icqq.profile.age` | integer \| null | 否 | — | — |
| `icqq.profile.birthday` | string \| null | 否 | — | — |
| `icqq.profile.signature` | string \| null | 否 | — | — |
| `icqq.profile.avatar` | string \| null | 否 | — | — |
| `icqq.profile.interests` | array \| null | 否 | — | — |
| `icqq.profile.bio` | string \| null | 否 | — | — |

### juejin

[`plugins/adapters/juejin/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/juejin/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `juejin.apiBaseUrl` | string | 否 | `"https://api.juejin.cn"` | — |
| `juejin.pollIntervalSec` | number | 否 | `60` | 轮询间隔（秒），最小 60，实际会加 0–20% 随机抖动 |
| `juejin.sendMode` | string: `"review"`, `"off"` | 否 | `"review"` | 出站模式：review=AI 回复只进草稿队列，master 在 Console 或用 juejin-draft send &lt;id&gt; 审批后才发出（默认）；off=禁止出站。不提供自动直发 |
| `juejin.minSendIntervalSec` | number | 否 | `30` | 审批后两次真实发送的最小间隔（秒），最小 10；不足时拒绝发送，不排队 |
| `juejin.dataDir` | string | 否 | `"data/juejin"` | 本地数据目录：待审草稿存在 &lt;dataDir&gt;/&lt;endpoint id&gt;/drafts.json（权限 600，相对进程工作目录），重启不丢。不要放进仓库 |
| `juejin.notify` | object | 否 | — | 有新草稿或登录失效时，主动发消息提醒到这个聊天会话（通常是你和机器人的私聊）。不填则只在 Console「掘金评论审批」页和日志里看到 |
| `juejin.notify.adapter` | string | 是 | — | 适配器名，如 icqq、telegram |
| `juejin.notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `juejin.notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型 |
| `juejin.notify.id` | string \| number | 是 | — | 会话 id：私聊填你的账号，群聊填群号 |
| `juejin.articles` | array&lt;string&gt; | 否 | — | 白名单文章：文章 id（请写成带引号的字符串）或 https://juejin.cn/post/&lt;id&gt; 链接。只轮询这些文章的评论，不做全站搜索；留空 = 不轮询 |
| `juejin.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `juejin.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `juejin.endpoints[].id` | string | 是 | — | Endpoint 名称（本地标识，不是掘金账号） |
| `juejin.endpoints[].cookie` | string | 否 | — | 掘金网页登录态 Cookie 整串（至少含 sessionid；以你的账号身份操作；请用 ${JUEJIN_COOKIE} 注入，切勿写入仓库） |
| `juejin.endpoints[].articles` | array&lt;string&gt; | 否 | — | 白名单文章：文章 id（请写成带引号的字符串）或 https://juejin.cn/post/&lt;id&gt; 链接。只轮询这些文章的评论，不做全站搜索；留空 = 不轮询 |
| `juejin.endpoints[].pollIntervalSec` | number | 否 | `60` | 轮询间隔（秒），最小 60，实际会加 0–20% 随机抖动 |
| `juejin.endpoints[].sendMode` | string: `"review"`, `"off"` | 否 | `"review"` | 出站模式：review=AI 回复只进草稿队列，master 在 Console 或用 juejin-draft send &lt;id&gt; 审批后才发出（默认）；off=禁止出站。不提供自动直发 |
| `juejin.endpoints[].minSendIntervalSec` | number | 否 | `30` | 审批后两次真实发送的最小间隔（秒），最小 10；不足时拒绝发送，不排队 |
| `juejin.endpoints[].dataDir` | string | 否 | `"data/juejin"` | 本地数据目录：待审草稿存在 &lt;dataDir&gt;/&lt;endpoint id&gt;/drafts.json（权限 600，相对进程工作目录），重启不丢。不要放进仓库 |
| `juejin.endpoints[].notify` | object | 否 | — | 有新草稿或登录失效时，主动发消息提醒到这个聊天会话（通常是你和机器人的私聊）。不填则只在 Console「掘金评论审批」页和日志里看到 |
| `juejin.endpoints[].notify.adapter` | string | 是 | — | 适配器名，如 icqq、telegram |
| `juejin.endpoints[].notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `juejin.endpoints[].notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型 |
| `juejin.endpoints[].notify.id` | string \| number | 是 | — | 会话 id：私聊填你的账号，群聊填群号 |
| `juejin.endpoints[].apiBaseUrl` | string | 否 | `"https://api.juejin.cn"` | — |
| `juejin.endpoints[].commandPrefix` | string | 否 | — | — |
| `juejin.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `juejin.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `juejin.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `juejin.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `juejin.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `juejin.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `juejin.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `juejin.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `juejin.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `juejin.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `juejin.profile` | object | 否 | — | 账号资料兜底 |
| `juejin.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `juejin.profile.age` | integer \| null | 否 | — | — |
| `juejin.profile.birthday` | string \| null | 否 | — | — |
| `juejin.profile.signature` | string \| null | 否 | — | — |
| `juejin.profile.avatar` | string \| null | 否 | — | — |
| `juejin.profile.interests` | array \| null | 否 | — | — |
| `juejin.profile.bio` | string \| null | 否 | — | — |

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
| `kook.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项定义一个 endpoint，id/token 必填，其余字段覆盖实例默认值 |
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
| `kook.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `kook.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `kook.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `kook.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `kook.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `kook.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `kook.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `kook.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `kook.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `kook.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `kook.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `kook.profile` | object | 否 | — | 账号资料兜底 |
| `kook.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `kook.profile.age` | integer \| null | 否 | — | — |
| `kook.profile.birthday` | string \| null | 否 | — | — |
| `kook.profile.signature` | string \| null | 否 | — | — |
| `kook.profile.avatar` | string \| null | 否 | — | — |
| `kook.profile.interests` | array \| null | 否 | — | — |
| `kook.profile.bio` | string \| null | 否 | — | — |

### lark

[`plugins/adapters/lark/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/lark/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `lark.webhookPath` | string | 否 | `"/lark/webhook"` | — |
| `lark.apiBaseUrl` | string | 否 | — | — |
| `lark.isFeishu` | boolean | 否 | `true` | — |
| `lark.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
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
| `lark.endpoints[].streaming` | boolean | 否 | — | Use native streaming cards for progressive replies. |
| `lark.endpoints[].streamingIntervalMs` | integer | 否 | — | Reply stream update interval in milliseconds. |
| `lark.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `lark.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `lark.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `lark.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `lark.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `lark.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `lark.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `lark.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `lark.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `lark.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `lark.mode` | string: `"webhook"`, `"websocket"` | 否 | `"webhook"` | — |
| `lark.webApiProxy` | object | 否 | — | 默认关闭；仅飞书出站API的loopback TLS故障代理，保留官方Host/SNI和证书校验，与streamProxy独立 |
| `lark.webApiProxy.port` | integer | 是 | — | — |
| `lark.streaming` | boolean | 否 | `true` | Use native streaming cards for progressive replies. |
| `lark.streamingIntervalMs` | integer | 否 | `1000` | Reply stream update interval in milliseconds. |
| `lark.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `lark.profile` | object | 否 | — | 账号资料兜底 |
| `lark.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `lark.profile.age` | integer \| null | 否 | — | — |
| `lark.profile.birthday` | string \| null | 否 | — | — |
| `lark.profile.signature` | string \| null | 否 | — | — |
| `lark.profile.avatar` | string \| null | 否 | — | — |
| `lark.profile.interests` | array \| null | 否 | — | — |
| `lark.profile.bio` | string \| null | 否 | — | — |

### line

[`plugins/adapters/line/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/line/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `line.webhookPath` | string | 否 | `"/line/webhook"` | — |
| `line.apiBaseUrl` | string | 否 | `"https://api.line.me"` | — |
| `line.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `line.endpoints[].channelSecret` | string | 是 | — | LINE channel secret |
| `line.endpoints[].channelAccessToken` | string | 是 | — | LINE channel access token |
| `line.endpoints[].webhookPath` | string | 否 | — | — |
| `line.endpoints[].apiBaseUrl` | string | 否 | — | — |
| `line.endpoints[].commandPrefix` | string | 否 | — | — |
| `line.endpoints[].id` | string | 是 | — | LINE bot name |
| `line.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `line.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `line.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `line.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `line.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `line.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `line.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `line.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `line.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `line.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `line.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `line.profile` | object | 否 | — | 账号资料兜底 |
| `line.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `line.profile.age` | integer \| null | 否 | — | — |
| `line.profile.birthday` | string \| null | 否 | — | — |
| `line.profile.signature` | string \| null | 否 | — | — |
| `line.profile.avatar` | string \| null | 否 | — | — |
| `line.profile.interests` | array \| null | 否 | — | — |
| `line.profile.bio` | string \| null | 否 | — | — |

### milky

[`plugins/adapters/milky/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/milky/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `milky.connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | 否 | `"ws"` | ws (default), sse (EventSource client), webhook or wss (webhook/wss via httpHostToken) |
| `milky.reconnect_interval` | number | 否 | `5000` | — |
| `milky.heartbeat_interval` | number | 否 | `30000` | — |
| `milky.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `milky.endpoints[].connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | 否 | — | — |
| `milky.endpoints[].baseUrl` | string | 是 | — | Milky HTTP API base URL (required); WS event path is derived as ws(s)://host/event |
| `milky.endpoints[].path` | string | 否 | — | Path for webhook / reverse-wss |
| `milky.endpoints[].access_token` | string | 否 | — | Milky access token |
| `milky.endpoints[].reconnect_interval` | number | 否 | — | — |
| `milky.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `milky.endpoints[].commandPrefix` | string | 否 | — | — |
| `milky.endpoints[].id` | string | 是 | — | Milky bot name |
| `milky.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `milky.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `milky.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `milky.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `milky.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `milky.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `milky.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `milky.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `milky.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `milky.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `milky.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `milky.profile` | object | 否 | — | 账号资料兜底 |
| `milky.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `milky.profile.age` | integer \| null | 否 | — | — |
| `milky.profile.birthday` | string \| null | 否 | — | — |
| `milky.profile.signature` | string \| null | 否 | — | — |
| `milky.profile.avatar` | string \| null | 否 | — | — |
| `milky.profile.interests` | array \| null | 否 | — | — |
| `milky.profile.bio` | string \| null | 否 | — | — |

### napcat

[`plugins/adapters/napcat/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/napcat/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `napcat.connection` | string: `"ws"`, `"wss"`, `"http"` | 否 | `"ws"` | ws (default), wss (reverse WS), or http (POST webhook + HTTP API outbound) |
| `napcat.reconnect_interval` | number | 否 | `5000` | — |
| `napcat.heartbeat_interval` | number | 否 | `30000` | — |
| `napcat.poll_interval` | number | 否 | `30000` | — |
| `napcat.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
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
| `napcat.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `napcat.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `napcat.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `napcat.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `napcat.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `napcat.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `napcat.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `napcat.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `napcat.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `napcat.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `napcat.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `napcat.profile` | object | 否 | — | 账号资料兜底 |
| `napcat.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `napcat.profile.age` | integer \| null | 否 | — | — |
| `napcat.profile.birthday` | string \| null | 否 | — | — |
| `napcat.profile.signature` | string \| null | 否 | — | — |
| `napcat.profile.avatar` | string \| null | 否 | — | — |
| `napcat.profile.interests` | array \| null | 否 | — | — |
| `napcat.profile.bio` | string \| null | 否 | — | — |

### onebot11

[`plugins/adapters/onebot11/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot11/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `onebot11.connection` | string: `"ws"`, `"wss"` | 否 | `"ws"` | connection: ws (forward WS client, default) or wss (reverse WS via httpHostToken) |
| `onebot11.reconnect_interval` | number | 否 | `5000` | — |
| `onebot11.heartbeat_interval` | number | 否 | `30000` | — |
| `onebot11.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `onebot11.endpoints[].connection` | string: `"ws"`, `"wss"` | 否 | — | — |
| `onebot11.endpoints[].url` | string | 否 | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `onebot11.endpoints[].path` | string | 否 | — | WS path for reverse-wss (connection: wss) |
| `onebot11.endpoints[].access_token` | string | 否 | — | OneBot access token |
| `onebot11.endpoints[].reconnect_interval` | number | 否 | — | — |
| `onebot11.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `onebot11.endpoints[].commandPrefix` | string | 否 | — | — |
| `onebot11.endpoints[].id` | string | 是 | — | OneBot11 bot name |
| `onebot11.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `onebot11.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `onebot11.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `onebot11.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `onebot11.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `onebot11.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `onebot11.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `onebot11.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `onebot11.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `onebot11.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `onebot11.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `onebot11.profile` | object | 否 | — | 账号资料兜底 |
| `onebot11.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `onebot11.profile.age` | integer \| null | 否 | — | — |
| `onebot11.profile.birthday` | string \| null | 否 | — | — |
| `onebot11.profile.signature` | string \| null | 否 | — | — |
| `onebot11.profile.avatar` | string \| null | 否 | — | — |
| `onebot11.profile.interests` | array \| null | 否 | — | — |
| `onebot11.profile.bio` | string \| null | 否 | — | — |

### onebot12

[`plugins/adapters/onebot12/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot12/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `onebot12.connection` | string: `"ws"`, `"webhook"`, `"wss"` | 否 | `"ws"` | ws (default), webhook (httpHostToken POST), or wss (reverse WS via httpHostToken) |
| `onebot12.reconnect_interval` | number | 否 | `5000` | — |
| `onebot12.heartbeat_interval` | number | 否 | `30000` | — |
| `onebot12.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项明确选择 platform/userId，id 为本地账号名称，其余连接字段覆盖实例默认值 |
| `onebot12.endpoints[].connection` | string: `"ws"`, `"webhook"`, `"wss"` | 否 | — | — |
| `onebot12.endpoints[].url` | string | 否 | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `onebot12.endpoints[].path` | string | 否 | — | HTTP/WS path for webhook or reverse-wss |
| `onebot12.endpoints[].api_url` | string | 否 | — | HTTP action endpoint for webhook outbound (required for connection: webhook send) |
| `onebot12.endpoints[].access_token` | string | 否 | — | OneBot access token |
| `onebot12.endpoints[].reconnect_interval` | number | 否 | — | — |
| `onebot12.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `onebot12.endpoints[].commandPrefix` | string | 否 | — | — |
| `onebot12.endpoints[].id` | string | 是 | — | OneBot12 bot name |
| `onebot12.endpoints[].platform` | string | 是 | — | Selected OneBot12 bot platform |
| `onebot12.endpoints[].userId` | string | 是 | — | Selected OneBot12 bot user ID |
| `onebot12.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `onebot12.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `onebot12.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `onebot12.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `onebot12.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `onebot12.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `onebot12.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `onebot12.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `onebot12.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `onebot12.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `onebot12.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `onebot12.profile` | object | 否 | — | 账号资料兜底 |
| `onebot12.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `onebot12.profile.age` | integer \| null | 否 | — | — |
| `onebot12.profile.birthday` | string \| null | 否 | — | — |
| `onebot12.profile.signature` | string \| null | 否 | — | — |
| `onebot12.profile.avatar` | string \| null | 否 | — | — |
| `onebot12.profile.interests` | array \| null | 否 | — | — |
| `onebot12.profile.bio` | string \| null | 否 | — | — |

### qq

[`plugins/adapters/qq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/qq/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `qq.mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | 否 | `"websocket"` | WebSocket gateway (default). webhook/middleware use httpHostToken POST. |
| `qq.sandbox` | boolean | 否 | `false` | — |
| `qq.botKind` | string: `"public"`, `"private"` | 否 | `"public"` | 公域/私域：均含 GROUP_AND_C2C_EVENT；频道消息分别为 PUBLIC_GUILD_MESSAGES / GUILD_MESSAGES。未显式配置 intents 时按此展开 |
| `qq.intents` | array&lt;string&gt; | 否 | — | WebSocket Identify intents；省略时按 botKind 自动生成（public→含 PUBLIC_GUILD_MESSAGES） |
| `qq.accessTokenUrl` | string | 否 | — | — |
| `qq.gatewayUrl` | string | 否 | — | — |
| `qq.webhookPath` | string | 否 | `"/qq/webhook"` | POST path on httpHostToken for webhook/middleware modes. |
| `qq.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项定义一个 endpoint，id/appid/secret 必填，其余字段覆盖实例默认值 |
| `qq.endpoints[].appid` | string | 是 | — | QQ official bot app ID |
| `qq.endpoints[].secret` | string | 是 | — | QQ official bot secret |
| `qq.endpoints[].mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | 否 | — | — |
| `qq.endpoints[].sandbox` | boolean | 否 | — | — |
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
| `qq.endpoints[].notify` | object | 否 | — | 掉线/登录失败时通过另一个适配器实例给 master 发通知（adapter/endpoint/kind/id 指向实际会话） |
| `qq.endpoints[].notify.adapter` | string | 是 | — | 通知使用的适配器类型，如 qq / icqq |
| `qq.endpoints[].notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `qq.endpoints[].notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型，默认 private |
| `qq.endpoints[].notify.id` | string \| number | 是 | — | master 在该平台上的会话 id（QQ 官方为 openid，ICQQ 为 QQ 号） |
| `qq.endpoints[].notify.parent` | object | 否 | — | 可选的父频道/群容器 |
| `qq.endpoints[].notify.parent.kind` | string: `"private"`, `"group"`, `"channel"` | 是 | — | — |
| `qq.endpoints[].notify.parent.id` | string \| number | 是 | — | — |
| `qq.endpoints[].streaming` | boolean | 否 | — | 在支持的会话中渐进发送回复。设为 false 时仅发送完整回复。 |
| `qq.endpoints[].streamingIntervalMs` | number | 否 | — | 后续回复更新的最小间隔（毫秒）；首段立即发送。 |
| `qq.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `qq.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `qq.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `qq.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `qq.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `qq.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `qq.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `qq.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `qq.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `qq.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `qq.streamProxy` | object | 否 | — | Optional fixed loopback TCP fault proxy for WSS only; original gateway TLS identity must match serverName. |
| `qq.streamProxy.port` | integer | 是 | — | — |
| `qq.streamProxy.serverName` | string | 是 | — | — |
| `qq.notify` | object | 否 | — | 掉线/登录失败时通过另一个适配器实例给 master 发通知（adapter/endpoint/kind/id 指向实际会话） |
| `qq.notify.adapter` | string | 是 | — | 通知使用的适配器类型，如 qq / icqq |
| `qq.notify.endpoint` | string | 是 | — | 该适配器的 endpoint id |
| `qq.notify.kind` | string: `"private"`, `"group"`, `"channel"` | 否 | `"private"` | 会话类型，默认 private |
| `qq.notify.id` | string \| number | 是 | — | master 在该平台上的会话 id（QQ 官方为 openid，ICQQ 为 QQ 号） |
| `qq.notify.parent` | object | 否 | — | 可选的父频道/群容器 |
| `qq.notify.parent.kind` | string: `"private"`, `"group"`, `"channel"` | 是 | — | — |
| `qq.notify.parent.id` | string \| number | 是 | — | — |
| `qq.streaming` | boolean | 否 | `true` | 在支持的会话中渐进发送回复。设为 false 时仅发送完整回复。 |
| `qq.streamingIntervalMs` | number | 否 | `500` | 后续回复更新的最小间隔（毫秒）；首段立即发送。 |
| `qq.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `qq.profile` | object | 否 | — | 账号资料兜底 |
| `qq.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `qq.profile.age` | integer \| null | 否 | — | — |
| `qq.profile.birthday` | string \| null | 否 | — | — |
| `qq.profile.signature` | string \| null | 否 | — | — |
| `qq.profile.avatar` | string \| null | 否 | — | — |
| `qq.profile.interests` | array \| null | 否 | — | — |
| `qq.profile.bio` | string \| null | 否 | — | — |

### sandbox

[`plugins/adapters/sandbox/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/sandbox/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `sandbox.streaming` | boolean | 否 | `true` | Publish supported replies while generating. Set false to send only complete replies. |
| `sandbox.streamingIntervalMs` | number | 否 | `500` | Minimum delay in milliseconds between reply updates; the first update is immediate. |
| `sandbox.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `sandbox.endpoints[].owner` | string | 否 | — | Sandbox owner user ID |
| `sandbox.endpoints[].streaming` | boolean | 否 | — | Publish supported replies while generating. Set false to send only complete replies. |
| `sandbox.endpoints[].streamingIntervalMs` | number | 否 | — | Minimum delay in milliseconds between reply updates; the first update is immediate. |
| `sandbox.endpoints[].commandPrefix` | string | 否 | — | — |
| `sandbox.endpoints[].id` | string | 是 | — | Sandbox bot name |
| `sandbox.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `sandbox.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `sandbox.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `sandbox.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `sandbox.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `sandbox.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `sandbox.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `sandbox.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `sandbox.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `sandbox.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `sandbox.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `sandbox.profile` | object | 否 | — | 账号资料兜底 |
| `sandbox.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `sandbox.profile.age` | integer \| null | 否 | — | — |
| `sandbox.profile.birthday` | string \| null | 否 | — | — |
| `sandbox.profile.signature` | string \| null | 否 | — | — |
| `sandbox.profile.avatar` | string \| null | 否 | — | — |
| `sandbox.profile.interests` | array \| null | 否 | — | — |
| `sandbox.profile.bio` | string \| null | 否 | — | — |

### satori

[`plugins/adapters/satori/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/satori/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `satori.connection` | string: `"ws"`, `"webhook"` | 否 | `"ws"` | ws (default) or webhook (httpHostToken POST route) |
| `satori.heartbeat_interval` | number | 否 | `10000` | WS PING interval in milliseconds |
| `satori.endpoints` | array&lt;object&gt; | 是 | — | 多账号：每项明确选择 platform/userId，id/baseUrl 必填，其余字段覆盖实例默认值 |
| `satori.endpoints[].baseUrl` | string | 是 | — | Satori SDK HTTP/WS base URL (e.g. http://127.0.0.1:5140) |
| `satori.endpoints[].connection` | string: `"ws"`, `"webhook"` | 否 | — | — |
| `satori.endpoints[].token` | string | 否 | — | Bearer token for API and WS IDENTIFY |
| `satori.endpoints[].path` | string | 否 | — | Webhook POST path (connection: webhook) |
| `satori.endpoints[].heartbeat_interval` | number | 否 | — | — |
| `satori.endpoints[].commandPrefix` | string | 否 | — | — |
| `satori.endpoints[].id` | string | 是 | — | Satori bot name |
| `satori.endpoints[].platform` | string | 是 | — | Selected Satori login platform |
| `satori.endpoints[].userId` | string | 是 | — | Selected Satori login user ID |
| `satori.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `satori.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `satori.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `satori.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `satori.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `satori.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `satori.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `satori.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `satori.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `satori.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `satori.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `satori.profile` | object | 否 | — | 账号资料兜底 |
| `satori.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `satori.profile.age` | integer \| null | 否 | — | — |
| `satori.profile.birthday` | string \| null | 否 | — | — |
| `satori.profile.signature` | string \| null | 否 | — | — |
| `satori.profile.avatar` | string \| null | 否 | — | — |
| `satori.profile.interests` | array \| null | 否 | — | — |
| `satori.profile.bio` | string \| null | 否 | — | — |

### slack

[`plugins/adapters/slack/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/slack/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `slack.socketMode` | boolean | 否 | `true` | Prefer Socket Mode (default). Set false for HTTP Events via httpHostToken. |
| `slack.webhookPath` | string | 否 | `"/slack/events"` | — |
| `slack.clientPingTimeout` | number | 否 | `15000` | Socket Mode client ping timeout (ms) |
| `slack.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
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
| `slack.endpoints[].streaming` | boolean | 否 | — | Use native streaming replies when the target supports them. |
| `slack.endpoints[].streamingIntervalMs` | integer | 否 | — | Reply stream update interval in milliseconds. |
| `slack.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `slack.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `slack.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `slack.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `slack.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `slack.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `slack.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `slack.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `slack.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `slack.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `slack.streaming` | boolean | 否 | `true` | Use native streaming replies when the target supports them. |
| `slack.streamingIntervalMs` | integer | 否 | `1000` | Reply stream update interval in milliseconds. |
| `slack.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `slack.profile` | object | 否 | — | 账号资料兜底 |
| `slack.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `slack.profile.age` | integer \| null | 否 | — | — |
| `slack.profile.birthday` | string \| null | 否 | — | — |
| `slack.profile.signature` | string \| null | 否 | — | — |
| `slack.profile.avatar` | string \| null | 否 | — | — |
| `slack.profile.interests` | array \| null | 否 | — | — |
| `slack.profile.bio` | string \| null | 否 | — | — |

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
| `telegram.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
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
| `telegram.endpoints[].streaming` | boolean | 否 | — | Publish supported replies while generating. Set false to send only complete replies. |
| `telegram.endpoints[].streamingIntervalMs` | number | 否 | — | Minimum delay in milliseconds between reply updates; the first update is immediate. |
| `telegram.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `telegram.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `telegram.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `telegram.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `telegram.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `telegram.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `telegram.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `telegram.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `telegram.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `telegram.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `telegram.streaming` | boolean | 否 | `true` | Publish supported replies while generating. Set false to send only complete replies. |
| `telegram.streamingIntervalMs` | number | 否 | `500` | Minimum delay in milliseconds between reply updates; the first update is immediate. |
| `telegram.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `telegram.profile` | object | 否 | — | 账号资料兜底 |
| `telegram.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `telegram.profile.age` | integer \| null | 否 | — | — |
| `telegram.profile.birthday` | string \| null | 否 | — | — |
| `telegram.profile.signature` | string \| null | 否 | — | — |
| `telegram.profile.avatar` | string \| null | 否 | — | — |
| `telegram.profile.interests` | array \| null | 否 | — | — |
| `telegram.profile.bio` | string \| null | 否 | — | — |

### wechat-mp

[`plugins/adapters/wechat-mp/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wechat-mp/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `wechat-mp.path` | string | 否 | `"/wechat/webhook"` | — |
| `wechat-mp.encrypt` | boolean | 否 | `false` | — |
| `wechat-mp.encryptMode` | string: `"plain"`, `"compatible"`, `"secure"` | 否 | — | Default follows encrypt: 'plain' when encrypt=false, 'compatible' when encrypt=true |
| `wechat-mp.replyMode` | string: `"passive"`, `"customer_service"` | 否 | `"passive"` | — |
| `wechat-mp.passiveReplyTimeoutMs` | number | 否 | `4500` | — |
| `wechat-mp.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
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
| `wechat-mp.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `wechat-mp.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `wechat-mp.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `wechat-mp.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `wechat-mp.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `wechat-mp.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `wechat-mp.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `wechat-mp.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `wechat-mp.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `wechat-mp.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `wechat-mp.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `wechat-mp.profile` | object | 否 | — | 账号资料兜底 |
| `wechat-mp.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `wechat-mp.profile.age` | integer \| null | 否 | — | — |
| `wechat-mp.profile.birthday` | string \| null | 否 | — | — |
| `wechat-mp.profile.signature` | string \| null | 否 | — | — |
| `wechat-mp.profile.avatar` | string \| null | 否 | — | — |
| `wechat-mp.profile.interests` | array \| null | 否 | — | — |
| `wechat-mp.profile.bio` | string \| null | 否 | — | — |

### wecom

[`plugins/adapters/wecom/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wecom/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `wecom.webhookPath` | string | 否 | `"/wecom/callback"` | — |
| `wecom.apiBaseUrl` | string | 否 | `"https://qyapi.weixin.qq.com"` | — |
| `wecom.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `wecom.endpoints[].corpId` | string | 是 | — | WeCom corp ID |
| `wecom.endpoints[].agentSecret` | string | 是 | — | WeCom agent secret |
| `wecom.endpoints[].token` | string | 是 | — | WeCom callback token |
| `wecom.endpoints[].encodingAESKey` | string | 是 | — | WeCom encoding AES key |
| `wecom.endpoints[].webhookPath` | string | 否 | — | — |
| `wecom.endpoints[].apiBaseUrl` | string | 否 | — | — |
| `wecom.endpoints[].commandPrefix` | string | 否 | — | — |
| `wecom.endpoints[].id` | string | 是 | — | WeCom bot name |
| `wecom.endpoints[].agentId` | string | 是 | — | 企业微信应用 AgentId（非应用 Secret） |
| `wecom.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `wecom.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `wecom.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `wecom.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `wecom.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `wecom.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `wecom.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `wecom.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `wecom.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `wecom.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `wecom.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `wecom.profile` | object | 否 | — | 账号资料兜底 |
| `wecom.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `wecom.profile.age` | integer \| null | 否 | — | — |
| `wecom.profile.birthday` | string \| null | 否 | — | — |
| `wecom.profile.signature` | string \| null | 否 | — | — |
| `wecom.profile.avatar` | string \| null | 否 | — | — |
| `wecom.profile.interests` | array \| null | 否 | — | — |
| `wecom.profile.bio` | string \| null | 否 | — | — |

### weixin-ilink

[`plugins/adapters/weixin-ilink/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/weixin-ilink/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `weixin-ilink.botAgent` | string | 否 | — | — |
| `weixin-ilink.baseUrl` | string | 否 | `"https://ilinkai.weixin.qq.com"` | — |
| `weixin-ilink.cdnBaseUrl` | string | 否 | `"https://novac2c.cdn.weixin.qq.com/c2c"` | — |
| `weixin-ilink.longPollTimeoutMs` | number | 否 | `35000` | — |
| `weixin-ilink.dataDir` | string | 否 | `"data/weixin-ilink"` | Endpoint state root for credentials, cursors, context tokens, and media |
| `weixin-ilink.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `weixin-ilink.endpoints[].botToken` | string | 否 | — | iLink bot token; omit to load endpoint state or start QR login |
| `weixin-ilink.endpoints[].id` | string | 是 | — | Weixin iLink bot name |
| `weixin-ilink.endpoints[].botAgent` | string | 否 | — | — |
| `weixin-ilink.endpoints[].baseUrl` | string | 否 | — | — |
| `weixin-ilink.endpoints[].cdnBaseUrl` | string | 否 | — | — |
| `weixin-ilink.endpoints[].longPollTimeoutMs` | number | 否 | — | — |
| `weixin-ilink.endpoints[].dataDir` | string | 否 | — | Endpoint state root |
| `weixin-ilink.endpoints[].commandPrefix` | string | 否 | — | 本 endpoint 的命令前缀 |
| `weixin-ilink.endpoints[].nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `weixin-ilink.endpoints[].profile` | object | 否 | — | 账号资料兜底 |
| `weixin-ilink.endpoints[].profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `weixin-ilink.endpoints[].profile.age` | integer \| null | 否 | — | — |
| `weixin-ilink.endpoints[].profile.birthday` | string \| null | 否 | — | — |
| `weixin-ilink.endpoints[].profile.signature` | string \| null | 否 | — | — |
| `weixin-ilink.endpoints[].profile.avatar` | string \| null | 否 | — | — |
| `weixin-ilink.endpoints[].profile.interests` | array \| null | 否 | — | — |
| `weixin-ilink.endpoints[].profile.bio` | string \| null | 否 | — | — |
| `weixin-ilink.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |
| `weixin-ilink.nickname` | string \| null | 否 | — | 账号昵称兜底 |
| `weixin-ilink.profile` | object | 否 | — | 账号资料兜底 |
| `weixin-ilink.profile.gender` | string \| null: `"male"`, `"female"`, `"other"`, `"unknown"`, `null` | 否 | — | — |
| `weixin-ilink.profile.age` | integer \| null | 否 | — | — |
| `weixin-ilink.profile.birthday` | string \| null | 否 | — | — |
| `weixin-ilink.profile.signature` | string \| null | 否 | — | — |
| `weixin-ilink.profile.avatar` | string \| null | 否 | — | — |
| `weixin-ilink.profile.interests` | array \| null | 否 | — | — |
| `weixin-ilink.profile.bio` | string \| null | 否 | — | — |

### process-monitor

[`plugins/features/process-monitor/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/features/process-monitor/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `process-monitor.enabled` | boolean | 否 | `true` | 是否启用进程监控 |
| `process-monitor.notifyOnStart` | boolean | 否 | `true` | 首次启动时通知 |
| `process-monitor.notifyOnRestart` | boolean | 否 | `true` | 正常重启时通知 |
| `process-monitor.notifyOnCrash` | boolean | 否 | `true` | 异常崩溃重启时通知 |
| `process-monitor.notifyChannels` | array&lt;object&gt; | 否 | `[]` | 通知渠道（slice-1 仅 webhook 生效） |
| `process-monitor.notifyChannels[].type` | string: `"webhook"` | 是 | — | 目前只支持 webhook |
| `process-monitor.notifyChannels[].target` | string | 是 | — | Webhook 地址 |

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

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

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

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

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

_该 Schema 没有声明字段。_

### 60s

[`plugins/utils/60s/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/60s/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `60s.apiBase` | string | 否 | `"https://60s.viki.moe"` | 60s API 服务的基础地址 |

### answers

[`plugins/utils/answers/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/answers/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；全部字段可在适配器 / 账号层覆盖；会话层字段: `dailyStable`、`quizTimeoutSeconds`、`enableDrivingQuiz`；群内自助: `quizTimeoutSeconds`、`enableDrivingQuiz`

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `answers.dailyStable` | boolean | 否 | `false` | 同一用户同一天问同一个问题时，答案之书给出相同答案 |
| `answers.timezone` | string | 否 | `"Asia/Shanghai"` | dailyStable 判断「同一天」所用的 IANA 时区 |
| `answers.quizTimeoutSeconds` | number | 否 | `120` | 出题后等待作答的秒数，超时题目作废 |
| `answers.enableDrivingQuiz` | boolean | 否 | `true` | 启用「科目一」交规小测（原创题面，仅供娱乐参考） |

### bilibili

[`plugins/utils/bilibili/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/bilibili/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `bilibili.pollCron` | string | 否 | `"0 * * * * *"` | 轮询频率（6 段 Cron，默认每 60 秒） |
| `bilibili.jitterMs` | number | 否 | `15000` | 每轮轮询前的随机延迟上限（毫秒） |
| `bilibili.requestGapMs` | number | 否 | `1500` | 同一轮内相邻动态请求的间隔（毫秒） |
| `bilibili.maxBackoffMinutes` | number | 否 | `30` | 接口失败或风控时指数退避的上限（分钟） |
| `bilibili.maxPerChannel` | number | 否 | `20` | 每个会话最多订阅的 UP 主数量 |
| `bilibili.timeout` | number | 否 | `10000` | 单次 HTTP 请求超时（毫秒） |
| `bilibili.live` | boolean | 否 | `true` | 是否轮询开播状态 |
| `bilibili.dynamic` | boolean | 否 | `true` | 是否轮询 UP 主动态 |
| `bilibili.cookie` | string | 否 | `""` | 可选的 B 站 Cookie（如 SESSDATA=...），风控严格时使用；请写成 ${BILIBILI_COOKIE}，不要把凭据直接写进配置 |

### calendar

[`plugins/utils/calendar/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/calendar/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `calendar.provider` | `"none"` \| `"caldav"` \| `"google"` \| `"microsoft"` | 否 | `"none"` | 日历后端；none 时工具返回未启用提示 |
| `calendar.timezone` | string | 否 | `"Asia/Manila"` | 解释无偏移时间与展示用的 IANA 时区 |
| `calendar.work_day_start` | string | 否 | `"09:00"` | 空闲时段计算使用的每日开始时间（HH:MM） |
| `calendar.work_day_end` | string | 否 | `"18:00"` | 空闲时段计算使用的每日结束时间（HH:MM） |
| `calendar.oauth_redirect_base_url` | string | 否 | `""` | 聊天授权回调的外部基础地址（如 https://bot.example.com）；留空时使用 zhin HTTP Host 的本机地址 |
| `calendar.oauth_callback_path` | string | 否 | `"/calendar/oauth/callback"` | 聊天授权回调路由，挂在 zhin HTTP Host 上；反向代理/隧道只转发部分路径时可调整 |
| `calendar.caldav` | object | 否 | — | — |
| `calendar.caldav.enabled` | boolean | 否 | `false` | — |
| `calendar.caldav.calendar_url` | string | 否 | `""` | 日历 collection URL |
| `calendar.caldav.username` | string | 否 | `""` | — |
| `calendar.caldav.password` | string | 否 | `""` | 建议写成环境变量引用 |
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

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `code-runner.provider` | `"piston"` \| `"glot"` | 否 | `"piston"` | 代码运行后端协议：piston（自建 Piston 的 /api/v2/execute）或 glot（glot.io 兼容的 /api/run） |
| `code-runner.endpoint` | string | 否 | `""` | 代码运行后端地址。piston 填完整执行地址（如 http://127.0.0.1:2000/api/v2/execute）；glot 填 run 前缀（如 https://glot.io/api/run）。留空时命令提示未配置；可写 ${CODE_RUNNER_ENDPOINT} |
| `code-runner.token` | string | 否 | — | 后端访问令牌（可选），建议写 ${CODE_RUNNER_TOKEN}。piston 作为 Authorization 头原样发送，glot 发送 Authorization: Token &lt;token&gt; |

### content-moderation

[`plugins/utils/content-moderation/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/content-moderation/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `content-moderation.groupModeration` | array&lt;object&gt; | 否 | `[]` | 自动广告/辱骂审核的精确范围；未配置时关闭。需要 AI、原子持久状态和适配器群管支持。禁言 / 踢人交给 Agent 群规（ADR 0039），名单内的群会生成待确认的默认规则，确认前只提醒 / 警告。 |
| `content-moderation.groupModeration[].adapter` | string | 是 | — | — |
| `content-moderation.groupModeration[].endpoint` | string | 是 | — | — |
| `content-moderation.groupModeration[].account` | string | 是 | — | — |
| `content-moderation.groupModeration[].group` | string | 是 | — | — |
| `content-moderation.enabled` | boolean | 否 | `true` | 总开关 |
| `content-moderation.onError` | string: `"open"`, `"closed"` | 否 | `"open"` | 审查源失败时的全局默认策略：open=视为通过，closed=视为 critical |
| `content-moderation.maskChar` | string | 否 | `"*"` | 文本打码字符 |
| `content-moderation.replyTemplate` | string | 否 | — | reply 动作时的提示文案；省略时按本次消息语言选择默认文案，显式文本保持原样 |
| `content-moderation.inbound` | object | 否 | — | — |
| `content-moderation.inbound.enabled` | boolean | 否 | `true` | — |
| `content-moderation.inbound.bypass` | array&lt;string&gt; | 否 | `["owner","platform:admin"]` | 满足任一 permit 表达式的发送者跳过入站审查（ADR 0056 §5 内置 DSL，与命令 / 工具同一评估器）。内容审核是平台功能，默认 zhin owner 或平台群主 / 管理员（platform:admin）；[] 表示都审 |
| `content-moderation.inbound.whitelist` | object | 否 | — | — |
| `content-moderation.inbound.whitelist.userIds` | array&lt;string&gt; | 否 | `[]` | 这些用户发送的消息不审查 |
| `content-moderation.inbound.whitelist.conversationIds` | array&lt;string&gt; | 否 | `[]` | 这些会话中的消息不审查 |
| `content-moderation.outbound` | object | 否 | — | — |
| `content-moderation.outbound.enabled` | boolean | 否 | `true` | — |
| `content-moderation.outbound.bypass` | boolean | 否 | `false` | 为 true 时跳过出站审查 |
| `content-moderation.actions` | object | 否 | — | severity → 动作（字符串或数组）；缺省用偏严默认表 |
| `content-moderation.actions.pass` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.low` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.medium` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.high` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.actions.critical` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `content-moderation.sources` | array&lt;object&gt; | 否 | `[]` | 按顺序执行的审查源：本地词库或 HTTP 审查服务 |
| `content-moderation.sources[].id` | string | 是 | — | — |
| `content-moderation.sources[].type` | string: `"local"`, `"http"` | 是 | — | local 为本地词库，http 为外部审查服务 |
| `content-moderation.sources[].enabled` | boolean | 否 | `true` | — |
| `content-moderation.sources[].onError` | string: `"open"`, `"closed"` | 否 | — | 此审查源失败时的策略，未填写时使用全局设置 |
| `content-moderation.sources[].includeBuiltin` | boolean | 否 | `true` | 是否合并内置分级违禁词词库 |
| `content-moderation.sources[].words` | array&lt;string \| object&gt; | 否 | `[]` | 自定义词：字符串（用 defaultSeverity）或 { word, severity } |
| `content-moderation.sources[].wordFiles` | array&lt;string&gt; | 否 | `[]` | 词库文件；行格式 word / severity:word / word\|severity |
| `content-moderation.sources[].defaultSeverity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | 否 | `"high"` | 未标注分级的自定义词默认 severity |
| `content-moderation.sources[].severity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | 否 | `"high"` | 兼容旧字段，等同 defaultSeverity |
| `content-moderation.sources[].url` | string | 否 | — | HTTP 审查服务的地址 |
| `content-moderation.sources[].headers` | object | 否 | — | 发送给审查服务的附加请求头 |
| `content-moderation.sources[].timeoutMs` | number | 否 | `5000` | 单次审查请求的超时 |
| `content-moderation.sources[].forceUpload` | boolean | 否 | `false` | 强制下载图片后上传，不传 URL |

### earthquake

[`plugins/utils/earthquake/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/earthquake/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

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

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；仅全局（其余字段可在适配器 / 账号层覆盖）: `keywordReply`、`teachAllowRegex`、`welcomeConversations`、`ephemeralKeywords`；会话层字段: `welcomeMessage`、`basePointsMin`、`basePointsMax`、`streakBonus`、`streakCap`、`rankSize`、`teachMaxPerGroup`、`teachCooldownMs`、`teachPageSize`；群内自助: `welcomeMessage`、`rankSize`、`teachCooldownMs`、`teachPageSize`

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `group-suite.keywordReply` | boolean | 否 | `false` | 开启后按词库自动回复匹配的消息（只能在全局修改） |
| `group-suite.basePointsMin` | number | 否 | `10` | 每次签到随机获得的基础积分下限 |
| `group-suite.basePointsMax` | number | 否 | `30` | 每次签到随机获得的基础积分上限 |
| `group-suite.streakBonus` | number | 否 | `5` | 连续签到每多一天额外奖励的积分 |
| `group-suite.streakCap` | number | 否 | `50` | 连续签到额外奖励的最高积分 |
| `group-suite.rankSize` | number | 否 | `10` | 签到与发言排行榜显示的人数 |
| `group-suite.teachMaxPerGroup` | number | 否 | `200` | 每个群最多保存的问答条数 |
| `group-suite.teachCooldownMs` | number | 否 | `3000` | 同一成员两次教学之间的最短间隔 |
| `group-suite.teachAllowRegex` | boolean | 否 | `false` | 允许成员教学正则表达式规则。默认关闭：正则会对每条入站消息执行；只接受结构安全的表达式，并且只对不超过 200 字的消息尝试匹配。 |
| `group-suite.teachPageSize` | number | 否 | `10` | teach-list 每页显示的问答条数 |
| `group-suite.welcomeMessage` | string | 否 | `""` | 新成员入群时发送的文本，留空则关闭；{name} 和 {id} 代表新成员。 |
| `group-suite.welcomeConversations` | array&lt;object&gt; | 否 | — | 发送欢迎语的精确会话名单。不填写时欢迎所有群；填 [] 则不欢迎任何会话。未填写父容器或话题时只匹配没有它们的会话，不支持通配。 |
| `group-suite.welcomeConversations[].endpoint` | object | 是 | — | — |
| `group-suite.welcomeConversations[].endpoint.adapter` | string | 是 | — | — |
| `group-suite.welcomeConversations[].endpoint.id` | string | 是 | — | — |
| `group-suite.welcomeConversations[].kind` | string: `"group"` | 是 | — | — |
| `group-suite.welcomeConversations[].id` | string | 是 | — | — |
| `group-suite.welcomeConversations[].parent` | object | 否 | — | — |
| `group-suite.welcomeConversations[].parent.kind` | string: `"private"`, `"group"`, `"channel"` | 是 | — | — |
| `group-suite.welcomeConversations[].parent.id` | string | 是 | — | — |
| `group-suite.welcomeConversations[].threadId` | string | 否 | — | — |
| `group-suite.ephemeralKeywords` | boolean | 否 | `false` | 显式使用不持久化的临时词库。为 false 时，自动回复要求启动时有数据库服务，词库管理在使用时要求持久状态服务。 |

### ledger

[`plugins/utils/ledger/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/ledger/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；仅全局（其余字段可在适配器 / 账号层覆盖）: `timezone`、`reportTime`；会话层字段: `reportWhenEmpty`

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

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `lottery.pickCount` | number | 否 | `5` | 每组推荐号码的个数 |
| `lottery.scheduleCron` | string | 否 | `"0 0 18 * * *"` | 定时生成推荐的 6 段 Cron 表达式 |
| `lottery.historyLimit` | number | 否 | `500` | 分析时读取的最多历史开奖期数 |
| `lottery.scheduleEnabled` | boolean | 否 | `true` | 按定时推荐时间自动生成并推送推荐 |
| `lottery.backtestEnabled` | boolean | 否 | `true` | 生成推荐前用历史数据回测模型 |
| `lottery.backtestWindow` | number | 否 | `50` | 回测抽样的最近期数 |
| `lottery.backtestRandomTrials` | number | 否 | `64` | 回测时随机基线的模拟次数 |
| `lottery.backtestMinHistory` | number | 否 | `30` | 历史期数少于此值时不回测 |
| `lottery.backtestAdaptive` | boolean | 否 | `true` | 回测时逐期调整模型权重 |
| `lottery.weightPersistEnabled` | boolean | 否 | `true` | 模拟或复盘后把权重写入数据库 |
| `lottery.weightHoldoutFallback` | boolean | 否 | `true` | 近期 holdout 表现不如随机时，推荐改用默认权重 |
| `lottery.games` | array&lt;string&gt; | 否 | `["kl8","ssq","dlt","fc3d","pl3","pl5"]` | 启用的彩票玩法（快乐8、双色球、大乐透、福彩3D、排列3、排列5） |
| `lottery.pushTargets` | array&lt;object&gt; | 否 | `[]` | 定时与开奖报告的推送会话 |
| `lottery.pushTargets[].adapter` | string | 是 | — | — |
| `lottery.pushTargets[].endpointKey` | string | 否 | — | — |
| `lottery.pushTargets[].channelType` | string | 否 | `"private"` | — |
| `lottery.pushTargets[].channelId` | string | 是 | — | — |
| `lottery.kl8` | object | 否 | — | — |
| `lottery.kl8.pickCount` | number | 否 | `5` | 快乐8 每组推荐几个号码 |
| `lottery.kl8.recommendGroups` | number | 否 | `3` | 快乐8 每次推荐的组数 |
| `lottery.kl8.groupStrategies` | array&lt;string&gt; | 否 | `["balanced","hot","cold"]` | 每组使用的选号策略（均衡、热号、冷号） |

### music

[`plugins/utils/music/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/music/schema.json)

_该 Schema 没有声明字段。_

### nettools

[`plugins/utils/nettools/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/nettools/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `nettools.cooldownSeconds` | integer | 否 | `10` | 每个用户的冷却秒数，所有网络工具命令和工具共用；0 表示不限制 |
| `nettools.requestTimeoutMs` | integer | 否 | `8000` | 每次外部 HTTP 请求的超时 |
| `nettools.maxRetries` | integer | 否 | `2` | 网络错误、超时、429 与 5xx 的重试次数（指数退避并加入随机抖动） |
| `nettools.pingMaxNodes` | integer | 否 | `4` | ping 使用的 check-host.net 探测节点数 |
| `nettools.pingPollIntervalMs` | integer | 否 | `2000` | 两次查询 ping 结果之间的等待时间 |
| `nettools.pingMaxPolls` | integer | 否 | `5` | 超过此次数仍未完成时返回部分结果 |
| `nettools.dohProviders` | array&lt;string: `"cloudflare"`, `"alidns"`, `"google"`&gt; | 否 | `["cloudflare","alidns","google"]` | DNS-over-HTTPS 服务，按顺序回退 |
| `nettools.priceListLimit` | integer | 否 | `8` | 域名比价显示的注册商数量 |

### qrcode

[`plugins/utils/qrcode/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/qrcode/schema.json)

_该 Schema 没有声明字段。_

### reminder

[`plugins/utils/reminder/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/reminder/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

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

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；全部字段可在适配器 / 账号层覆盖；会话层字段: `threshold`、`cooldown`；群内自助: `threshold`

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `repeater.threshold` | number | 否 | `3` | 触发复读的最少人数 |
| `repeater.cooldown` | number | 否 | `30000` | 同一群冷却时间 (ms) |
| `repeater.maxLength` | number | 否 | `200` | 消息长度上限 |

### rss

[`plugins/utils/rss/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/rss/schema.json)

> 分层配置（ADR 0050 / 0055） — 层级: `global`、`adapter`、`endpoint`、`conversation`；字段仅全局；会话层字段: 仅开关

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `rss.pollCron` | string | 否 | `"0 */5 * * * *"` | 轮询频率 (6 段 Cron 表达式) |
| `rss.maxPerGroup` | number | 否 | `30` | 每个会话最多订阅的 feed 数量 |
| `rss.maxItems` | number | 否 | `5` | 一次推送最多展示的文章条数，其余只提示数量 |
| `rss.timeout` | number | 否 | `15000` | 拉取一次 feed 的超时 |
| `rss.allowPrivateNetwork` | boolean | 否 | `false` | 允许订阅回环/内网地址上的 feed（如自建 RSSHub）。默认拒绝，因为订阅地址来自聊天用户。 |

### short-url

[`plugins/utils/short-url/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/short-url/schema.json)

_该 Schema 没有声明字段。_
