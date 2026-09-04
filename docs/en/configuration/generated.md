---
title: Generated configuration field reference
outline: [2, 3]
---

# Generated configuration field reference

> Generated from runtime source and JSON Schema. Do not edit manually. See [Configuration](./) for narrative guidance and examples.

- Generator: `pnpm docs:config`
- Drift check: `pnpm check:config-reference`

## Host top-level fields

The authoritative contract is [`packages/im/runtime/src/host-config-schema.json`](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json), consumed by the Runtime at [`basic/cli/src/plugin-runtime/console-api-installer.ts`](https://github.com/zhinjs/zhin/blob/main/basic/cli/src/plugin-runtime/console-api-installer.ts).

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `http` | object | no | — | HTTP, Console, REST/RPC/SSE, and Webhook Host. |
| `database` | object | no | — | Database Host and dialect connection options. |
| `ai` | object | no | — | Providers, Agents, sessions, memory, tools, and execution security. |
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
| `ai.agent.inboundQueue.groupMode` | string: `"supersede"`, `"fifo"` | no | — | Replace an older queued group turn, or process all turns in arrival order. |
| `ai.agent.execSecurity` | string: `"deny"`, `"allowlist"`, `"full"` | no | — | Shell command security boundary. |
| `ai.agent.execPreset` | string: `"readonly"`, `"network"`, `"development"`, `"custom"` | no | — | Command allowlist preset used outside full mode. |
| `ai.agent.execApprovalMode` | string: `"ask"`, `"allow"`, `"deny"` | no | — | Approval policy for main Agent commands. |
| `ai.agent.subagentExecApprovalMode` | string: `"ask"`, `"allow"`, `"deny"` | no | — | Approval policy for sub-Agent commands. |
| `ai.agent.workerExecApprovalMode` | string: `"ask"`, `"allow"`, `"deny"` | no | — | Approval policy for worker commands. |
| `ai.agent.taskExecApprovalMode` | string: `"ask"`, `"allow"`, `"deny"` | no | — | Approval policy for task commands. |
| `ai.agent.toolExecution` | string: `"parallel"`, `"sequential"`, `"tiered"` | no | — | How tool calls in one model step are scheduled. |
| `ai.agent.modelSizeHint` | string: `""`, `"small"`, `"medium"`, `"large"` | no | — | Optional model-size hint; an empty string clears the hint. |
| `ai.agent.promptCacheRetention` | string: `"in_memory"`, `"24h"` | no | — | Provider prompt-cache retention policy. |
| `ai.agent.steeringMode` | string: `"one-at-a-time"`, `"all"` | no | — | Process steering messages one at a time or drain all pending messages together. |
| `ai.agent.followUpMode` | string: `"one-at-a-time"`, `"all"` | no | — | Process follow-up messages one at a time or drain all pending messages together. |
| `ai.agent.outputSchema` | boolean \| string: `"segments"` \| object | no | — | Structured final-output mode: false for text, true or segments for canonical message segments, or a custom JSON Schema object. |
| `ai.agent.schedule` | object | no | — | Unattended Schedule execution policy. |
| `ai.agent.schedule.security` | object | no | — | Schedule command security policy. |
| `ai.agent.schedule.security.execPreset` | string: `"readonly"`, `"network"` | no | — | Schedule Jobs may use only the read-only or network preset. |
| `mcp` | object | no | — | Expose Bot tools through an MCP Server. |
| `a2a` | object | no | — | A2A Agent Card, remote execution, and Workroom callbacks. |
| `speech` | object | no | — | Speech-to-text and text-to-speech Host. |
| `htmlRenderer` | object | no | — | HTML and image rendering options backed by Shotium. |
| `htmlRenderer.width` | number | no | `800` | Default layout width in CSS pixels. |
| `htmlRenderer.defaultWidth` | number | no | `800` | Legacy alias of width. |
| `htmlRenderer.viewport` | object | no | — | Default viewport for Shotium rendering. |
| `htmlRenderer.viewport.width` | number | no | `800` | Viewport width in CSS pixels. |
| `htmlRenderer.viewport.height` | number | no | `600` | Viewport height in CSS pixels. |
| `htmlRenderer.backgroundColor` | string | no | `"#ffffff"` | Fragment background color. |
| `htmlRenderer.defaultBackgroundColor` | string | no | `"#ffffff"` | Legacy alias of backgroundColor. |
| `htmlRenderer.scale` | number | no | `1` | Device scale factor. |
| `htmlRenderer.type` | string: `"png"`, `"jpeg"`, `"webp"` | no | `"png"` | Default raster output format. |
| `htmlRenderer.quality` | number | no | `90` | Quality for jpeg/webp output. |
| `htmlRenderer.timeout` | number | no | `30000` | Navigation timeout in milliseconds. |
| `htmlRenderer.waitUntil` | string: `"load"`, `"networkidle"` | no | `"load"` | Navigation wait strategy. |
| `htmlRenderer.fontFamily` | string | no | `"-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\", sans-serif"` | Default font-family for fragments. |
| `htmlRenderer.maxImageHeight` | number | no | `0` | Split overly tall PNGs above this height; 0 disables splitting. |
| `htmlRenderer.sliceCompression` | number | no | `3` | Compression level used when splitting PNGs. |
| `htmlRenderer.allowFileAccess` | boolean | no | `true` | Allow local file subresources. |
| `htmlRenderer.takeOverHtmlSegments` | boolean | no | `true` | Take over html/markdown rich-segment image rendering. |
| `htmlRenderer.cacheDir` | string | no | `""` | HTTP cache directory; use off to disable. |
| `htmlRenderer.cacheMaxBytes` | number | no | `268435456` | Maximum HTTP cache size in bytes. |
| `htmlRenderer.userAgent` | string | no | `""` | Custom user agent string. |
| `htmlRenderer.idleTimeoutMs` | number | no | `300000` | Daemon idle-exit timeout in milliseconds. |
| `htmlRenderer.logStats` | boolean | no | `false` | Log render timing statistics. |
| `htmlRenderer.mode` | string: `"inprocess"`, `"daemon"` | no | `"inprocess"` | Whether Shotium runs in-process or as a daemon. |
| `htmlRenderer.aiTextAsImage` | boolean \| object | no | — | Optional plain-text to image conversion before send. |
| `assistant` | object | no | — | Scheduled jobs, event ingress, and failure notifications. |
| `log_level` | string \| number | no | — | Runtime log level. |
| `plugin` | object | no | — | Root Plugin configuration; replaced by its project schema during composition. |

## Plugin instance fields

These fields are read directly from each plugin `schema.json`. The `<name>` in `plugins.<name>` is the default instanceKey.

### dingtalk

[`plugins/adapters/dingtalk/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/dingtalk/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.dingtalk.apiBaseUrl` | string | no | `"https://oapi.dingtalk.com"` | — |
| `plugins.dingtalk.master` | string \| number | no | — | 框架 master（DingTalk userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.dingtalk.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.dingtalk.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.dingtalk.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（DingTalk userid）；覆盖顶层 master |
| `plugins.dingtalk.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.dingtalk.endpoints[].appKey` | string | yes | — | Dingtalk app key |
| `plugins.dingtalk.endpoints[].appSecret` | string | yes | — | Dingtalk app secret |
| `plugins.dingtalk.endpoints[].webhookPath` | string | yes | — | Dingtalk webhook path |
| `plugins.dingtalk.endpoints[].robotCode` | string | yes | — | Dingtalk robot code |
| `plugins.dingtalk.endpoints[].id` | string | yes | — | Dingtalk bot name |
| `plugins.dingtalk.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### discord

[`plugins/adapters/discord/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/discord/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.discord.connection` | string: `"gateway"`, `"interactions"` | no | `"gateway"` | Gateway WebSocket (default). interactions uses httpHostToken POST + Ed25519 verify. |
| `plugins.discord.intents` | array&lt;number&gt; | no | — | — |
| `plugins.discord.enableSlashCommands` | boolean | no | `false` | — |
| `plugins.discord.globalCommands` | boolean | no | `false` | — |
| `plugins.discord.defaultActivity` | object | no | — | — |
| `plugins.discord.defaultActivity.name` | string | yes | — | — |
| `plugins.discord.defaultActivity.type` | string: `"PLAYING"`, `"STREAMING"`, `"LISTENING"`, `"WATCHING"`, `"COMPETING"` | yes | — | — |
| `plugins.discord.defaultActivity.url` | string | no | — | — |
| `plugins.discord.slashCommands` | array&lt;object&gt; | no | — | — |
| `plugins.discord.applicationId` | string | no | — | Required when connection is interactions. |
| `plugins.discord.publicKey` | string | no | — | Required when connection is interactions (hex Ed25519 public key). |
| `plugins.discord.interactionsPath` | string | no | `"/discord/interactions"` | POST path on httpHostToken when connection is interactions. |
| `plugins.discord.master` | string \| number | no | — | 框架 master（Discord user snowflake；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.discord.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.discord.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.discord.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Discord user snowflake）；覆盖顶层 master |
| `plugins.discord.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.discord.endpoints[].token` | string | yes | — | Discord bot token |
| `plugins.discord.endpoints[].id` | string | yes | — | Discord bot name |
| `plugins.discord.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### email

[`plugins/adapters/email/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/email/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.email.master` | string \| number | no | — | 框架 master（email address；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.email.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.email.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.email.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（email address）；覆盖顶层 master |
| `plugins.email.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.email.endpoints[].smtp` | object | yes | — | — |
| `plugins.email.endpoints[].smtp.host` | string | yes | — | — |
| `plugins.email.endpoints[].smtp.port` | number | yes | — | — |
| `plugins.email.endpoints[].smtp.secure` | boolean | yes | — | — |
| `plugins.email.endpoints[].smtp.auth` | object | yes | — | — |
| `plugins.email.endpoints[].smtp.auth.user` | string | yes | — | — |
| `plugins.email.endpoints[].smtp.auth.pass` | string | yes | — | — |
| `plugins.email.endpoints[].imap` | object | yes | — | — |
| `plugins.email.endpoints[].imap.host` | string | yes | — | — |
| `plugins.email.endpoints[].imap.port` | number | yes | — | — |
| `plugins.email.endpoints[].imap.tls` | boolean | yes | — | — |
| `plugins.email.endpoints[].imap.user` | string | yes | — | — |
| `plugins.email.endpoints[].imap.password` | string | yes | — | — |
| `plugins.email.endpoints[].imap.checkInterval` | number | no | `60000` | — |
| `plugins.email.endpoints[].imap.mailbox` | string | no | `"INBOX"` | — |
| `plugins.email.endpoints[].imap.markSeen` | boolean | no | `true` | — |
| `plugins.email.endpoints[].attachments` | object | no | — | — |
| `plugins.email.endpoints[].attachments.enabled` | boolean | no | `false` | — |
| `plugins.email.endpoints[].attachments.downloadPath` | string | no | — | — |
| `plugins.email.endpoints[].attachments.maxFileSize` | number | no | — | — |
| `plugins.email.endpoints[].attachments.allowedTypes` | array&lt;string&gt; | no | — | — |
| `plugins.email.endpoints[].id` | string | yes | — | Email bot name |
| `plugins.email.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### github

[`plugins/adapters/github/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/github/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.github.host` | string | no | — | GitHub Enterprise hostname (default github.com) |
| `plugins.github.webhook_path` | string | no | `"/github/webhook"` | — |
| `plugins.github.webhookPath` | string | no | `"/github/webhook"` | — |
| `plugins.github.poll_interval` | number | no | `60` | Deferred: polling fallback was removed in the Plugin Runtime migration; currently parsed but unused |
| `plugins.github.auto_reply_repos` | array&lt;string&gt; | no | — | Repos whose Issue/PR comments auto-trigger AI without @bot |
| `plugins.github.bot_login` | string | no | — | Override App bot login (default {slug}[bot]) |
| `plugins.github.workspace_root` | string | no | — | Managed git workspace root |
| `plugins.github.master` | string \| number | no | — | 框架 master（GitHub user login or id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.github.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.github.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint |
| `plugins.github.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（GitHub user login or id）；覆盖顶层 master |
| `plugins.github.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.github.endpoints[].app_id` | string \| number | no | — | GitHub App ID |
| `plugins.github.endpoints[].appId` | string \| number | no | — | GitHub App ID (camelCase alias) |
| `plugins.github.endpoints[].private_key` | string | no | — | GitHub App private key (PEM content or file path) |
| `plugins.github.endpoints[].privateKey` | string | no | — | GitHub App private key (camelCase alias) |
| `plugins.github.endpoints[].webhook_secret` | string | no | — | Webhook HMAC secret; enables httpHostToken POST route |
| `plugins.github.endpoints[].webhookSecret` | string | no | — | Webhook HMAC secret (camelCase alias) |
| `plugins.github.endpoints[].id` | string | yes | — | GitHub App bot name |
| `plugins.github.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### icqq

[`plugins/adapters/icqq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/icqq/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.icqq.master` | string \| number | yes | — | 框架 master QQ uin（/approve、AI/工具权限）；endpoints[i].master 可逐项覆盖 |
| `plugins.icqq.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted QQ uin 列表（弱于 master） |
| `plugins.icqq.password` | string | no | — | QQ 密码（可选，不填则扫码登录） |
| `plugins.icqq.platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | no | `1` | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `plugins.icqq.ver` | string | no | — | 协议版本号，仅在对应 platform 有多个版本时有效，不填则使用最新版本 |
| `plugins.icqq.signApiAddr` | string | no | — | 签名服务器地址；未配置时若安装了 @icqqjs/qqsign 则自动使用本地签名 |
| `plugins.icqq.dataDir` | string | no | — | 数据存储文件夹路径，默认为主模块下的 data 文件夹 |
| `plugins.icqq.autoReconnect` | boolean | no | `true` | 断线后是否自动重连（默认 true） |
| `plugins.icqq.outboundMedia` | string: `"file"`, `"base64"` | no | `"file"` | 出站媒体模式：file=落盘本地路径（默认）; base64=CQ base64:// 内联 |
| `plugins.icqq.ignoreSelf` | boolean | no | `true` | 群聊和频道中是否过滤自己的消息（默认 true） |
| `plugins.icqq.resend` | boolean | no | `false` | 被风控时是否尝试用分片发送（默认 false） |
| `plugins.icqq.cacheGroupMember` | boolean | no | `true` | 是否缓存群员列表（默认 true）；群多时（500+）会多占约 100MB+ 内存 |
| `plugins.icqq.autoServer` | boolean | no | `true` | 是否自动选择最优服务器（默认 true） |
| `plugins.icqq.qqnt` | boolean | no | `true` | 是否使用 QQNT 协议（默认 true） |
| `plugins.icqq.ntLogin` | boolean | no | — | 是否使用 NT 登录方式 |
| `plugins.icqq.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.icqq.endpoints[].id` | string | yes | — | QQ uin |
| `plugins.icqq.endpoints[].master` | string \| number | no | — | 本 endpoint 的 master QQ uin；覆盖顶层 master |
| `plugins.icqq.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.icqq.endpoints[].password` | string | no | — | 本 endpoint 的 QQ 密码 |
| `plugins.icqq.endpoints[].platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | no | — | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `plugins.icqq.endpoints[].ver` | string | no | — | 协议版本号 |
| `plugins.icqq.endpoints[].signApiAddr` | string | no | — | 签名服务器地址 |
| `plugins.icqq.endpoints[].dataDir` | string | no | — | 数据存储文件夹路径 |
| `plugins.icqq.endpoints[].autoReconnect` | boolean | no | — | 断线后是否自动重连 |
| `plugins.icqq.endpoints[].outboundMedia` | string: `"file"`, `"base64"` | no | — | 出站媒体模式 |
| `plugins.icqq.endpoints[].ignoreSelf` | boolean | no | — | 是否过滤自己的消息 |
| `plugins.icqq.endpoints[].resend` | boolean | no | — | 被风控时是否分片发送 |
| `plugins.icqq.endpoints[].cacheGroupMember` | boolean | no | — | 是否缓存群员列表 |
| `plugins.icqq.endpoints[].autoServer` | boolean | no | — | 是否自动选择最优服务器 |
| `plugins.icqq.endpoints[].qqnt` | boolean | no | — | 是否使用 QQNT 协议 |
| `plugins.icqq.endpoints[].ntLogin` | boolean | no | — | 是否使用 NT 登录方式 |
| `plugins.icqq.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀）。endpoints[i] 可逐项覆盖 |

### kook

[`plugins/adapters/kook/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/kook/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.kook.connection` | string: `"websocket"`, `"webhook"` | no | `"websocket"` | WebSocket gateway (default). webhook requires httpHostToken, verify_token, and a public HTTPS callback URL. |
| `plugins.kook.webhookPath` | string | no | `"/kook/webhook"` | POST path registered via httpHostToken when connection is webhook. |
| `plugins.kook.data_dir` | string | no | — | — |
| `plugins.kook.timeout` | number | no | `10000` | — |
| `plugins.kook.max_retry` | number | no | `3` | — |
| `plugins.kook.ignore` | string: `"bot"`, `"self"` | no | `"bot"` | — |
| `plugins.kook.logLevel` | string: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`, `"mark"`, `"off"` | no | `"info"` | — |
| `plugins.kook.master` | string \| number | no | — | 框架 master（KOOK user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.kook.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.kook.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.kook.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（KOOK user id）；覆盖顶层 master |
| `plugins.kook.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.kook.endpoints[].token` | string | yes | — | KOOK bot token |
| `plugins.kook.endpoints[].verify_token` | string | no | — | KOOK developer console verify token (required for webhook mode). |
| `plugins.kook.endpoints[].encrypt_key` | string | no | — | Optional Encrypt Key when message encryption is enabled in KOOK console. |
| `plugins.kook.endpoints[].id` | string | yes | — | KOOK bot name |
| `plugins.kook.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### lark

[`plugins/adapters/lark/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/lark/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.lark.webhookPath` | string | no | `"/lark/webhook"` | — |
| `plugins.lark.apiBaseUrl` | string | no | — | — |
| `plugins.lark.isFeishu` | boolean | no | `true` | — |
| `plugins.lark.master` | string \| number | no | — | 框架 master（Lark/Feishu open_id or user_id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.lark.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.lark.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.lark.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Lark/Feishu open_id or user_id）；覆盖顶层 master |
| `plugins.lark.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.lark.endpoints[].appId` | string | yes | — | Lark app ID |
| `plugins.lark.endpoints[].appSecret` | string | yes | — | Lark app secret |
| `plugins.lark.endpoints[].encryptKey` | string | no | — | Lark encrypt key |
| `plugins.lark.endpoints[].verificationToken` | string | no | — | Lark verification token |
| `plugins.lark.endpoints[].id` | string | yes | — | Lark bot name |
| `plugins.lark.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### line

[`plugins/adapters/line/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/line/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.line.webhookPath` | string | no | `"/line/webhook"` | — |
| `plugins.line.apiBaseUrl` | string | no | `"https://api.line.me"` | — |
| `plugins.line.master` | string \| number | no | — | 框架 master（LINE user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.line.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.line.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.line.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（LINE user id）；覆盖顶层 master |
| `plugins.line.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.line.endpoints[].channelSecret` | string | yes | — | LINE channel secret |
| `plugins.line.endpoints[].channelAccessToken` | string | yes | — | LINE channel access token |
| `plugins.line.endpoints[].id` | string | yes | — | LINE bot name |
| `plugins.line.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### milky

[`plugins/adapters/milky/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/milky/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.milky.connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | no | `"ws"` | ws (default), sse (EventSource client), webhook or wss (webhook/wss via httpHostToken) |
| `plugins.milky.reconnect_interval` | number | no | `5000` | — |
| `plugins.milky.heartbeat_interval` | number | no | `30000` | — |
| `plugins.milky.master` | string \| number | no | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.milky.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.milky.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.milky.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `plugins.milky.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.milky.endpoints[].baseUrl` | string | yes | — | Milky HTTP API base URL (required); WS event path is derived as ws(s)://host/event |
| `plugins.milky.endpoints[].path` | string | no | — | Path for webhook / reverse-wss |
| `plugins.milky.endpoints[].access_token` | string | no | — | Milky access token |
| `plugins.milky.endpoints[].id` | string | yes | — | Milky bot name |
| `plugins.milky.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### napcat

[`plugins/adapters/napcat/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/napcat/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.napcat.connection` | string: `"ws"`, `"wss"`, `"http"` | no | `"ws"` | ws (default), wss (reverse WS), or http (POST webhook + HTTP API outbound) |
| `plugins.napcat.reconnect_interval` | number | no | `5000` | — |
| `plugins.napcat.heartbeat_interval` | number | no | `30000` | — |
| `plugins.napcat.poll_interval` | number | no | `30000` | — |
| `plugins.napcat.master` | string \| number | no | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.napcat.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.napcat.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.napcat.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `plugins.napcat.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.napcat.endpoints[].url` | string | no | — | NapCat WebSocket URL (required for connection: ws) |
| `plugins.napcat.endpoints[].path` | string | no | — | WS path for reverse-wss |
| `plugins.napcat.endpoints[].http_url` | string | no | — | HTTP API base URL (connection: http outbound) |
| `plugins.napcat.endpoints[].post_path` | string | no | — | HTTP POST event path (connection: http inbound) |
| `plugins.napcat.endpoints[].access_token` | string | no | — | NapCat access token |
| `plugins.napcat.endpoints[].id` | string | yes | — | NapCat bot name |
| `plugins.napcat.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot11

[`plugins/adapters/onebot11/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot11/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.onebot11.connection` | string: `"ws"`, `"wss"` | no | `"ws"` | connection: ws (forward WS client, default) or wss (reverse WS via httpHostToken) |
| `plugins.onebot11.reconnect_interval` | number | no | `5000` | — |
| `plugins.onebot11.heartbeat_interval` | number | no | `30000` | — |
| `plugins.onebot11.master` | string \| number | no | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.onebot11.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.onebot11.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.onebot11.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `plugins.onebot11.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.onebot11.endpoints[].url` | string | no | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `plugins.onebot11.endpoints[].path` | string | no | — | WS path for reverse-wss (connection: wss) |
| `plugins.onebot11.endpoints[].access_token` | string | no | — | OneBot access token |
| `plugins.onebot11.endpoints[].id` | string | yes | — | OneBot11 bot name |
| `plugins.onebot11.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot12

[`plugins/adapters/onebot12/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot12/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.onebot12.connection` | string: `"ws"`, `"webhook"`, `"wss"` | no | `"ws"` | ws (default), webhook (httpHostToken POST), or wss (reverse WS via httpHostToken) |
| `plugins.onebot12.reconnect_interval` | number | no | `5000` | — |
| `plugins.onebot12.heartbeat_interval` | number | no | `30000` | — |
| `plugins.onebot12.master` | string \| number | no | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.onebot12.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.onebot12.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.onebot12.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `plugins.onebot12.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.onebot12.endpoints[].url` | string | no | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `plugins.onebot12.endpoints[].path` | string | no | — | HTTP/WS path for webhook or reverse-wss |
| `plugins.onebot12.endpoints[].api_url` | string | no | — | HTTP action endpoint for webhook outbound (required for connection: webhook send) |
| `plugins.onebot12.endpoints[].access_token` | string | no | — | OneBot access token |
| `plugins.onebot12.endpoints[].id` | string | yes | — | OneBot12 bot name |
| `plugins.onebot12.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### qq

[`plugins/adapters/qq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/qq/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.qq.mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | no | `"websocket"` | WebSocket gateway (default). webhook/middleware use httpHostToken POST. |
| `plugins.qq.sandbox` | boolean | no | `false` | — |
| `plugins.qq.botKind` | string: `"public"`, `"private"` | no | `"public"` | 公域/私域：均含 GROUP_AND_C2C_EVENT；频道消息分别为 PUBLIC_GUILD_MESSAGES / GUILD_MESSAGES。未显式配置 intents 时按此展开 |
| `plugins.qq.master` | string \| number | no | — | 框架 master（endpoint 管理命令、AI/工具权限）；openid。endpoints[i].master 可逐项覆盖 |
| `plugins.qq.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.qq.intents` | array&lt;string&gt; | no | — | WebSocket Identify intents；省略时按 botKind 自动生成（public→含 PUBLIC_GUILD_MESSAGES） |
| `plugins.qq.accessTokenUrl` | string | no | — | — |
| `plugins.qq.gatewayUrl` | string | no | — | — |
| `plugins.qq.webhookPath` | string | no | `"/qq/webhook"` | POST path on httpHostToken for webhook/middleware modes. |
| `plugins.qq.port` | number | no | — | Legacy standalone webhook port (unused with httpHostToken). |
| `plugins.qq.path` | string | no | — | Legacy standalone webhook path (unused with httpHostToken). |
| `plugins.qq.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.qq.endpoints[].appid` | string | yes | — | QQ official bot app ID |
| `plugins.qq.endpoints[].secret` | string | yes | — | QQ official bot secret |
| `plugins.qq.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（openid）；覆盖顶层 master |
| `plugins.qq.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.qq.endpoints[].botKind` | string: `"public"`, `"private"` | no | — | 覆盖顶层 botKind（公域/私域），用于按 endpoint 生成 intents |
| `plugins.qq.endpoints[].intents` | array&lt;string&gt; | no | — | 覆盖顶层 intents |
| `plugins.qq.endpoints[].id` | string | yes | — | QQ bot name |
| `plugins.qq.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### sandbox

[`plugins/adapters/sandbox/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/sandbox/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.sandbox.master` | string \| number | no | — | 框架 master（sandbox client id (distinct from endpoints[].owner)；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.sandbox.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.sandbox.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.sandbox.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（sandbox client id (distinct from endpoints[].owner)）；覆盖顶层 master |
| `plugins.sandbox.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.sandbox.endpoints[].context` | string | no | — | Sandbox context identifier |
| `plugins.sandbox.endpoints[].owner` | string | no | — | Sandbox owner user ID |
| `plugins.sandbox.endpoints[].id` | string | yes | — | Sandbox bot name |
| `plugins.sandbox.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### satori

[`plugins/adapters/satori/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/satori/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.satori.connection` | string: `"ws"`, `"webhook"` | no | `"ws"` | ws (default) or webhook (httpHostToken POST route) |
| `plugins.satori.heartbeat_interval` | number | no | `10000` | WS PING interval in milliseconds |
| `plugins.satori.master` | string \| number | no | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.satori.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.satori.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.satori.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `plugins.satori.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.satori.endpoints[].baseUrl` | string | yes | — | Satori SDK HTTP/WS base URL (e.g. http://127.0.0.1:5140) |
| `plugins.satori.endpoints[].token` | string | no | — | Bearer token for API and WS IDENTIFY |
| `plugins.satori.endpoints[].path` | string | no | — | Webhook POST path (connection: webhook) |
| `plugins.satori.endpoints[].id` | string | yes | — | Satori bot name |
| `plugins.satori.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### slack

[`plugins/adapters/slack/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/slack/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.slack.socketMode` | boolean | no | `true` | Prefer Socket Mode (default). Set false for HTTP Events via httpHostToken. |
| `plugins.slack.webhookPath` | string | no | `"/slack/events"` | — |
| `plugins.slack.clientPingTimeout` | number | no | `15000` | Socket Mode client ping timeout (ms) |
| `plugins.slack.master` | string \| number | no | — | 框架 master（Slack user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.slack.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.slack.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.slack.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Slack user id）；覆盖顶层 master |
| `plugins.slack.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.slack.endpoints[].token` | string | yes | — | Bot User OAuth Token (xoxb-...) |
| `plugins.slack.endpoints[].signingSecret` | string | no | — | Required for HTTP Events API (socketMode: false) |
| `plugins.slack.endpoints[].appToken` | string | no | — | App-Level Token (xapp-...) for Socket Mode |
| `plugins.slack.endpoints[].id` | string | yes | — | Slack bot name |
| `plugins.slack.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### telegram

[`plugins/adapters/telegram/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/telegram/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.telegram.polling` | boolean | no | `true` | Long-poll getUpdates (default). Set false for webhook via httpHostToken. |
| `plugins.telegram.webhook` | object | no | — | Webhook settings when polling is false. |
| `plugins.telegram.webhook.domain` | string | no | — | — |
| `plugins.telegram.webhook.path` | string | no | `"/telegram/webhook"` | — |
| `plugins.telegram.webhook.secretToken` | string | no | — | Verified via X-Telegram-Bot-Api-Secret-Token. |
| `plugins.telegram.allowedUpdates` | array&lt;string&gt; | no | `["message","callback_query"]` | — |
| `plugins.telegram.apiBaseUrl` | string | no | `"https://api.telegram.org"` | — |
| `plugins.telegram.master` | string \| number | no | — | 框架 master（Telegram user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.telegram.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.telegram.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.telegram.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Telegram user id）；覆盖顶层 master |
| `plugins.telegram.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.telegram.endpoints[].token` | string | yes | — | Telegram bot token |
| `plugins.telegram.endpoints[].id` | string | yes | — | Telegram bot name |
| `plugins.telegram.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wechat-mp

[`plugins/adapters/wechat-mp/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wechat-mp/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.wechat-mp.path` | string | no | `"/wechat/webhook"` | — |
| `plugins.wechat-mp.encrypt` | boolean | no | `false` | — |
| `plugins.wechat-mp.encryptMode` | string: `"plain"`, `"compatible"`, `"secure"` | no | — | Default follows encrypt: 'plain' when encrypt=false, 'compatible' when encrypt=true |
| `plugins.wechat-mp.replyMode` | string: `"passive"`, `"customer_service"` | no | `"passive"` | — |
| `plugins.wechat-mp.passiveReplyTimeoutMs` | number | no | `4500` | — |
| `plugins.wechat-mp.master` | string \| number | no | — | 框架 master（WeChat OpenID；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.wechat-mp.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.wechat-mp.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.wechat-mp.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（WeChat OpenID）；覆盖顶层 master |
| `plugins.wechat-mp.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.wechat-mp.endpoints[].appId` | string | yes | — | WeChat MP app ID |
| `plugins.wechat-mp.endpoints[].appSecret` | string | yes | — | WeChat MP app secret |
| `plugins.wechat-mp.endpoints[].token` | string | yes | — | WeChat MP callback token |
| `plugins.wechat-mp.endpoints[].encodingAESKey` | string | no | — | WeChat MP encoding AES key |
| `plugins.wechat-mp.endpoints[].id` | string | yes | — | WeChat MP bot name |
| `plugins.wechat-mp.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wecom

[`plugins/adapters/wecom/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wecom/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.wecom.webhookPath` | string | no | `"/wecom/callback"` | — |
| `plugins.wecom.apiBaseUrl` | string | no | `"https://qyapi.weixin.qq.com"` | — |
| `plugins.wecom.master` | string \| number | no | — | 框架 master（WeCom userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.wecom.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.wecom.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.wecom.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（WeCom userid）；覆盖顶层 master |
| `plugins.wecom.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.wecom.endpoints[].corpId` | string | yes | — | WeCom corp ID |
| `plugins.wecom.endpoints[].agentSecret` | string | yes | — | WeCom agent secret |
| `plugins.wecom.endpoints[].token` | string | yes | — | WeCom callback token |
| `plugins.wecom.endpoints[].encodingAESKey` | string | yes | — | WeCom encoding AES key |
| `plugins.wecom.endpoints[].id` | string | yes | — | WeCom bot name |
| `plugins.wecom.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### weixin-ilink

[`plugins/adapters/weixin-ilink/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/weixin-ilink/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.weixin-ilink.botAgent` | string | no | — | — |
| `plugins.weixin-ilink.baseUrl` | string | no | `"https://ilinkai.weixin.qq.com"` | — |
| `plugins.weixin-ilink.cdnBaseUrl` | string | no | `"https://novac2c.cdn.weixin.qq.com/c2c"` | — |
| `plugins.weixin-ilink.longPollTimeoutMs` | number | no | `35000` | — |
| `plugins.weixin-ilink.master` | string \| number | no | — | 框架 master（Weixin user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.weixin-ilink.trusted` | array&lt;string \| number&gt; | no | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.weixin-ilink.endpoints` | array&lt;object&gt; | yes | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.weixin-ilink.endpoints[].master` | string \| number | no | — | 本 endpoint 的框架 master（Weixin user id）；覆盖顶层 master |
| `plugins.weixin-ilink.endpoints[].trusted` | array&lt;string \| number&gt; | no | — | 本 endpoint 的 trusted 列表 |
| `plugins.weixin-ilink.endpoints[].botToken` | string | yes | — | iLink bot token (prefer env WEIXIN_ILINK_TOKEN or sidecar credential file) |
| `plugins.weixin-ilink.endpoints[].id` | string | yes | — | Weixin iLink bot name |
| `plugins.weixin-ilink.commandPrefix` | string | no | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### process-monitor

[`plugins/features/process-monitor/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/features/process-monitor/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.process-monitor.enabled` | boolean | no | `true` | 是否启用进程监控 |
| `plugins.process-monitor.notifyOnStart` | boolean | no | `true` | 首次启动时通知 |
| `plugins.process-monitor.notifyOnRestart` | boolean | no | `true` | 正常重启时通知 |
| `plugins.process-monitor.notifyOnCrash` | boolean | no | `true` | 异常崩溃重启时通知 |
| `plugins.process-monitor.notifyChannels` | array&lt;object&gt; | no | `[]` | 通知渠道（slice-1 仅 webhook 生效） |
| `plugins.process-monitor.notifyChannels[].type` | string: `"user"`, `"group"`, `"webhook"` | yes | — | — |
| `plugins.process-monitor.notifyChannels[].target` | string | yes | — | — |
| `plugins.process-monitor.notifyChannels[].platform` | string | no | — | — |

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
| `plugins.activity-feedback.enabled` | boolean | no | `true` | Enable activity feedback for this plugin instance. |
| `plugins.activity-feedback.defaults` | object | no | — | Default policy for all platforms and Endpoints. |
| `plugins.activity-feedback.defaults.enabled` | boolean | no | `true` | Enable this policy layer. |
| `plugins.activity-feedback.defaults.phases` | object | no | — | Feedback policy keyed by lifecycle phase. |
| `plugins.activity-feedback.defaults.phases.queued` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.queued.private` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.queued.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.queued.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.queued.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.queued.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.queued.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.queued.group` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.queued.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.queued.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.queued.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.queued.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.queued.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.queued.channel` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.queued.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.queued.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.queued.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.queued.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.queued.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.active` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.active.private` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.active.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.active.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.active.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.active.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.active.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.active.group` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.active.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.active.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.active.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.active.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.active.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.active.channel` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.active.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.active.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.active.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.active.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.active.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.thinking` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.thinking.private` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.thinking.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.thinking.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.thinking.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.thinking.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.thinking.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.thinking.group` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.thinking.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.thinking.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.thinking.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.thinking.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.thinking.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.thinking.channel` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.thinking.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.thinking.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.thinking.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.thinking.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.thinking.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_start` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_start.private` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_start.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_start.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_start.group` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_start.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_start.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_start.channel` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_start.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_finish` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_finish.private` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.group` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.channel` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_error` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_error.private` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_error.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_error.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_error.group` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_error.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_error.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.defaults.phases.schedule_error.channel` | object | no | — | — |
| `plugins.activity-feedback.defaults.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.defaults.phases.schedule_error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.defaults.phases.schedule_error.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.defaults.phases.schedule_error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.defaults.phases.schedule_error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.defaults.phases.schedule_error.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms` | object | no | — | Platform overrides keyed by platform name; values use the same shape as defaults. |
| `plugins.activity-feedback.platforms.<platform>.enabled` | boolean | no | `true` | Enable this policy layer. |
| `plugins.activity-feedback.platforms.<platform>.phases` | object | no | — | Feedback policy keyed by lifecycle phase. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.private` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.group` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.channel` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.queued.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.active` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.active.private` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.group` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.channel` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.active.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.private` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.group` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.channel` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.thinking.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.private` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.group` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.channel` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.private` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.group` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.channel` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.private` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.group` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.channel` | object | no | — | — |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.platforms.<platform>.phases.schedule_error.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints` | object | no | — | Endpoint overrides keyed by platform:endpointKey; values use the same shape as defaults. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.enabled` | boolean | no | `true` | Enable this policy layer. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases` | object | no | — | Feedback policy keyed by lifecycle phase. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.queued.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.group` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.active.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.thinking.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel` | object | no | — | — |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.endpoints.<platform:endpointKey>.phases.schedule_error.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule` | object | no | — | Schedule-only start, finish, and error feedback. |
| `plugins.activity-feedback.schedule.phases` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.start` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.start.private` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.start.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.start.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.start.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.start.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.start.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.start.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.start.group` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.start.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.start.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.start.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.start.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.start.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.start.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.start.channel` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.start.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.start.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.start.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.start.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.start.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.start.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.finish` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.finish.private` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.finish.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.finish.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.finish.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.finish.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.finish.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.finish.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.finish.group` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.finish.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.finish.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.finish.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.finish.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.finish.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.finish.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.finish.channel` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.finish.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.finish.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.finish.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.finish.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.finish.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.finish.channel.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.error` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.error.private` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.error.private.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.error.private.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.error.private.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.error.private.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.error.private.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.error.private.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.error.group` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.error.group.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.error.group.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.error.group.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.error.group.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.error.group.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.error.group.platformConfig` | object | no | — | Platform-specific options. |
| `plugins.activity-feedback.schedule.phases.error.channel` | object | no | — | — |
| `plugins.activity-feedback.schedule.phases.error.channel.type` | string: `"reaction"`, `"message"`, `"typing"`, `"none"` | no | — | How the phase is presented. |
| `plugins.activity-feedback.schedule.phases.error.channel.emoji` | string | no | — | Reaction value for type=reaction. |
| `plugins.activity-feedback.schedule.phases.error.channel.message` | string | no | — | Status text for type=message. |
| `plugins.activity-feedback.schedule.phases.error.channel.autoRemove` | boolean | no | `true` | Remove the feedback after the phase stops. |
| `plugins.activity-feedback.schedule.phases.error.channel.removeDelay` | number | no | — | Delay before removal in milliseconds; negative values are normalized to zero at runtime. |
| `plugins.activity-feedback.schedule.phases.error.channel.platformConfig` | object | no | — | Platform-specific options. |

### 60s

[`plugins/utils/60s/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/60s/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.60s.apiBase` | string | no | `"https://60s.viki.moe"` | 60s API base URL |

### code-runner

[`plugins/utils/code-runner/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/code-runner/schema.json)

_This Schema declares no fields._

### content-moderation

[`plugins/utils/content-moderation/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/content-moderation/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.content-moderation.enabled` | boolean | no | `true` | 总开关 |
| `plugins.content-moderation.onError` | string: `"open"`, `"closed"` | no | `"open"` | 审查源失败时的全局默认策略：open=视为通过，closed=视为 critical |
| `plugins.content-moderation.maskChar` | string | no | `"*"` | 文本打码字符 |
| `plugins.content-moderation.replyTemplate` | string | no | `"消息含不当内容，已拦截。"` | reply 动作时的提示文案 |
| `plugins.content-moderation.masters` | array&lt;string&gt; | no | `[]` | 额外视为 master 的 userId（兜底，与 endpoint master 合并） |
| `plugins.content-moderation.inbound` | object | no | — | — |
| `plugins.content-moderation.inbound.enabled` | boolean | no | `true` | — |
| `plugins.content-moderation.inbound.bypassMasters` | boolean | no | `true` | master 跳过入站审查 |
| `plugins.content-moderation.inbound.whitelist` | object | no | — | — |
| `plugins.content-moderation.inbound.whitelist.userIds` | array&lt;string&gt; | no | `[]` | — |
| `plugins.content-moderation.inbound.whitelist.conversationIds` | array&lt;string&gt; | no | `[]` | — |
| `plugins.content-moderation.outbound` | object | no | — | — |
| `plugins.content-moderation.outbound.enabled` | boolean | no | `true` | — |
| `plugins.content-moderation.outbound.bypass` | boolean | no | `false` | 为 true 时跳过出站审查 |
| `plugins.content-moderation.actions` | object | no | — | severity → 动作（字符串或数组）；缺省用偏严默认表 |
| `plugins.content-moderation.actions.pass` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `plugins.content-moderation.actions.low` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `plugins.content-moderation.actions.medium` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `plugins.content-moderation.actions.high` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `plugins.content-moderation.actions.critical` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | no | — | — |
| `plugins.content-moderation.sources` | array&lt;object&gt; | no | `[]` | — |
| `plugins.content-moderation.sources[].id` | string | yes | — | — |
| `plugins.content-moderation.sources[].type` | string: `"local"`, `"http"` | yes | — | — |
| `plugins.content-moderation.sources[].enabled` | boolean | no | `true` | — |
| `plugins.content-moderation.sources[].onError` | string: `"open"`, `"closed"` | no | — | — |
| `plugins.content-moderation.sources[].includeBuiltin` | boolean | no | `true` | 是否合并内置分级违禁词词库 |
| `plugins.content-moderation.sources[].words` | array&lt;string \| object&gt; | no | `[]` | 自定义词：字符串（用 defaultSeverity）或 { word, severity } |
| `plugins.content-moderation.sources[].wordFiles` | array&lt;string&gt; | no | `[]` | 词库文件；行格式 word / severity:word / word\|severity |
| `plugins.content-moderation.sources[].defaultSeverity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | no | `"high"` | 未标注分级的自定义词默认 severity |
| `plugins.content-moderation.sources[].severity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | no | `"high"` | 兼容旧字段，等同 defaultSeverity |
| `plugins.content-moderation.sources[].url` | string | no | — | — |
| `plugins.content-moderation.sources[].headers` | object | no | — | — |
| `plugins.content-moderation.sources[].timeoutMs` | number | no | `5000` | — |
| `plugins.content-moderation.sources[].forceUpload` | boolean | no | `false` | 强制下载图片后上传，不传 URL |

### group-suite

[`plugins/utils/group-suite/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.group-suite.keywordReply` | boolean | no | `false` | — |
| `plugins.group-suite.basePointsMin` | number | no | `10` | — |
| `plugins.group-suite.basePointsMax` | number | no | `30` | — |
| `plugins.group-suite.streakBonus` | number | no | `5` | — |
| `plugins.group-suite.streakCap` | number | no | `50` | — |
| `plugins.group-suite.rankSize` | number | no | `10` | — |
| `plugins.group-suite.teachMaxPerGroup` | number | no | `200` | — |
| `plugins.group-suite.teachCooldownMs` | number | no | `3000` | — |
| `plugins.group-suite.teachAllowRegex` | boolean | no | `true` | — |
| `plugins.group-suite.teachPageSize` | number | no | `10` | — |

### link-poster

[`plugins/utils/link-poster/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/link-poster/schema.json)

_This Schema declares no fields._

### lottery

[`plugins/utils/lottery/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/lottery/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.lottery.pickCount` | number | no | `5` | — |
| `plugins.lottery.scheduleCron` | string | no | `"0 0 18 * * *"` | — |
| `plugins.lottery.historyLimit` | number | no | `500` | — |
| `plugins.lottery.scheduleEnabled` | boolean | no | `true` | — |
| `plugins.lottery.backtestEnabled` | boolean | no | `true` | — |
| `plugins.lottery.backtestWindow` | number | no | `50` | — |
| `plugins.lottery.backtestRandomTrials` | number | no | `64` | — |
| `plugins.lottery.backtestMinHistory` | number | no | `30` | — |
| `plugins.lottery.backtestAdaptive` | boolean | no | `true` | — |
| `plugins.lottery.weightPersistEnabled` | boolean | no | `true` | — |
| `plugins.lottery.weightHoldoutFallback` | boolean | no | `true` | — |
| `plugins.lottery.games` | array&lt;string&gt; | no | `["kl8","ssq","dlt","fc3d","pl3","pl5"]` | — |
| `plugins.lottery.pushTargets` | array&lt;object&gt; | no | `[]` | OutboundHost push destinations for cron/publish reports |
| `plugins.lottery.pushTargets[].adapter` | string | yes | — | — |
| `plugins.lottery.pushTargets[].endpointId` | string | no | — | — |
| `plugins.lottery.pushTargets[].channelType` | string | no | `"private"` | — |
| `plugins.lottery.pushTargets[].channelId` | string | yes | — | — |
| `plugins.lottery.kl8` | object | no | — | — |
| `plugins.lottery.kl8.pickCount` | number | no | `5` | — |
| `plugins.lottery.kl8.recommendGroups` | number | no | `3` | — |
| `plugins.lottery.kl8.groupStrategies` | array&lt;string&gt; | no | `["balanced","hot","cold"]` | — |

### music

[`plugins/utils/music/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/music/schema.json)

_This Schema declares no fields._

### qrcode

[`plugins/utils/qrcode/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/qrcode/schema.json)

_This Schema declares no fields._

### repeater

[`plugins/utils/repeater/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/repeater/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.repeater.threshold` | number | no | `3` | 触发复读的最少人数 |
| `plugins.repeater.cooldown` | number | no | `30000` | 同一群冷却时间 (ms) |
| `plugins.repeater.maxLength` | number | no | `200` | 消息长度上限 |

### rss

[`plugins/utils/rss/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/rss/schema.json)

| Path | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins.rss.pollCron` | string | no | `"0 */5 * * * *"` | 轮询频率 (6 段 Cron 表达式) |
| `plugins.rss.maxPerGroup` | number | no | `30` | — |
| `plugins.rss.maxItems` | number | no | `5` | — |
| `plugins.rss.timeout` | number | no | `15000` | — |

### short-url

[`plugins/utils/short-url/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/short-url/schema.json)

_This Schema declares no fields._
