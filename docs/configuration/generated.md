---
title: 自动生成配置字段参考
outline: [2, 3]
---

# 自动生成配置字段参考

> 本页由源码与 JSON Schema 自动生成，请勿手工编辑。叙事、示例与配置方法见[配置参考](./)。

- 生成命令: `pnpm docs:config`
- 漂移检查: `pnpm check:config-reference`

## Host 顶层字段

权威契约来自 Runtime 实际消费的 [`packages/im/runtime/src/host-config-schema.json`](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json)；消费位置见 [`basic/cli/src/plugin-runtime/console-api-installer.ts`](https://github.com/zhinjs/zhin/blob/main/basic/cli/src/plugin-runtime/console-api-installer.ts)。

| 路径 | 类型 | 说明 | 来源 |
| --- | --- | --- | --- |
| `http` | object | HTTP、Console、REST/RPC/SSE 与 Webhook Host。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `database` | object | Database Host 与方言连接参数。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `ai` | object | Provider、Agent、会话、记忆、工具与执行安全策略。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `mcp` | object | 把 Bot 工具公开为 MCP Server。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `a2a` | object | A2A Agent Card、远程执行与 Workroom 回调。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `speech` | object | 语音识别与语音合成 Host。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `htmlRenderer` | object | HTML/图片渲染参数。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `assistant` | object | 调度任务、事件入口和失败通知。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `log_level` | string \| number | Runtime 日志级别。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |
| `plugin` | object | Root Plugin 配置；组合时由项目 Schema 替换。 | [source](https://github.com/zhinjs/zhin/blob/main/packages/im/runtime/src/host-config-schema.json) |

## 插件实例字段

以下字段直接读取仓库中每个插件发布的 `schema.json`。`plugins.<name>` 中的 `<name>` 是默认 instanceKey。

### dingtalk

[`plugins/adapters/dingtalk/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/dingtalk/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.dingtalk.apiBaseUrl` | string | 否 | `"https://oapi.dingtalk.com"` | — |
| `plugins.dingtalk.master` | string \| number | 否 | — | 框架 master（DingTalk userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.dingtalk.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.dingtalk.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.dingtalk.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（DingTalk userid）；覆盖顶层 master |
| `plugins.dingtalk.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.dingtalk.endpoints[].appKey` | string | 是 | — | Dingtalk app key |
| `plugins.dingtalk.endpoints[].appSecret` | string | 是 | — | Dingtalk app secret |
| `plugins.dingtalk.endpoints[].webhookPath` | string | 是 | — | Dingtalk webhook path |
| `plugins.dingtalk.endpoints[].robotCode` | string | 是 | — | Dingtalk robot code |
| `plugins.dingtalk.endpoints[].id` | string | 是 | — | Dingtalk bot name |
| `plugins.dingtalk.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### discord

[`plugins/adapters/discord/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/discord/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.discord.connection` | string: `"gateway"`, `"interactions"` | 否 | `"gateway"` | Gateway WebSocket (default). interactions uses httpHostToken POST + Ed25519 verify. |
| `plugins.discord.intents` | array&lt;number&gt; | 否 | — | — |
| `plugins.discord.enableSlashCommands` | boolean | 否 | `false` | — |
| `plugins.discord.globalCommands` | boolean | 否 | `false` | — |
| `plugins.discord.defaultActivity` | object | 否 | — | — |
| `plugins.discord.defaultActivity.name` | string | 是 | — | — |
| `plugins.discord.defaultActivity.type` | string: `"PLAYING"`, `"STREAMING"`, `"LISTENING"`, `"WATCHING"`, `"COMPETING"` | 是 | — | — |
| `plugins.discord.defaultActivity.url` | string | 否 | — | — |
| `plugins.discord.slashCommands` | array&lt;object&gt; | 否 | — | — |
| `plugins.discord.applicationId` | string | 否 | — | Required when connection is interactions. |
| `plugins.discord.publicKey` | string | 否 | — | Required when connection is interactions (hex Ed25519 public key). |
| `plugins.discord.interactionsPath` | string | 否 | `"/discord/interactions"` | POST path on httpHostToken when connection is interactions. |
| `plugins.discord.master` | string \| number | 否 | — | 框架 master（Discord user snowflake；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.discord.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.discord.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.discord.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Discord user snowflake）；覆盖顶层 master |
| `plugins.discord.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.discord.endpoints[].token` | string | 是 | — | Discord bot token |
| `plugins.discord.endpoints[].id` | string | 是 | — | Discord bot name |
| `plugins.discord.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### email

[`plugins/adapters/email/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/email/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.email.master` | string \| number | 否 | — | 框架 master（email address；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.email.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.email.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.email.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（email address）；覆盖顶层 master |
| `plugins.email.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.email.endpoints[].smtp` | object | 是 | — | — |
| `plugins.email.endpoints[].smtp.host` | string | 是 | — | — |
| `plugins.email.endpoints[].smtp.port` | number | 是 | — | — |
| `plugins.email.endpoints[].smtp.secure` | boolean | 是 | — | — |
| `plugins.email.endpoints[].smtp.auth` | object | 是 | — | — |
| `plugins.email.endpoints[].smtp.auth.user` | string | 是 | — | — |
| `plugins.email.endpoints[].smtp.auth.pass` | string | 是 | — | — |
| `plugins.email.endpoints[].imap` | object | 是 | — | — |
| `plugins.email.endpoints[].imap.host` | string | 是 | — | — |
| `plugins.email.endpoints[].imap.port` | number | 是 | — | — |
| `plugins.email.endpoints[].imap.tls` | boolean | 是 | — | — |
| `plugins.email.endpoints[].imap.user` | string | 是 | — | — |
| `plugins.email.endpoints[].imap.password` | string | 是 | — | — |
| `plugins.email.endpoints[].imap.checkInterval` | number | 否 | `60000` | — |
| `plugins.email.endpoints[].imap.mailbox` | string | 否 | `"INBOX"` | — |
| `plugins.email.endpoints[].imap.markSeen` | boolean | 否 | `true` | — |
| `plugins.email.endpoints[].attachments` | object | 否 | — | — |
| `plugins.email.endpoints[].attachments.enabled` | boolean | 否 | `false` | — |
| `plugins.email.endpoints[].attachments.downloadPath` | string | 否 | — | — |
| `plugins.email.endpoints[].attachments.maxFileSize` | number | 否 | — | — |
| `plugins.email.endpoints[].attachments.allowedTypes` | array&lt;string&gt; | 否 | — | — |
| `plugins.email.endpoints[].id` | string | 是 | — | Email bot name |
| `plugins.email.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### github

[`plugins/adapters/github/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/github/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.github.host` | string | 否 | — | GitHub Enterprise hostname (default github.com) |
| `plugins.github.webhook_path` | string | 否 | `"/github/webhook"` | — |
| `plugins.github.webhookPath` | string | 否 | `"/github/webhook"` | — |
| `plugins.github.poll_interval` | number | 否 | `60` | Deferred: polling fallback was removed in the Plugin Runtime migration; currently parsed but unused |
| `plugins.github.auto_reply_repos` | array&lt;string&gt; | 否 | — | Repos whose Issue/PR comments auto-trigger AI without @bot |
| `plugins.github.bot_login` | string | 否 | — | Override App bot login (default {slug}[bot]) |
| `plugins.github.workspace_root` | string | 否 | — | Managed git workspace root |
| `plugins.github.master` | string \| number | 否 | — | 框架 master（GitHub user login or id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.github.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.github.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint |
| `plugins.github.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（GitHub user login or id）；覆盖顶层 master |
| `plugins.github.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.github.endpoints[].app_id` | string \| number | 否 | — | GitHub App ID |
| `plugins.github.endpoints[].appId` | string \| number | 否 | — | GitHub App ID (camelCase alias) |
| `plugins.github.endpoints[].private_key` | string | 否 | — | GitHub App private key (PEM content or file path) |
| `plugins.github.endpoints[].privateKey` | string | 否 | — | GitHub App private key (camelCase alias) |
| `plugins.github.endpoints[].webhook_secret` | string | 否 | — | Webhook HMAC secret; enables httpHostToken POST route |
| `plugins.github.endpoints[].webhookSecret` | string | 否 | — | Webhook HMAC secret (camelCase alias) |
| `plugins.github.endpoints[].id` | string | 是 | — | GitHub App bot name |
| `plugins.github.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### icqq

[`plugins/adapters/icqq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/icqq/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.icqq.master` | string \| number | 是 | — | 框架 master QQ uin（/approve、AI/工具权限）；endpoints[i].master 可逐项覆盖 |
| `plugins.icqq.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted QQ uin 列表（弱于 master） |
| `plugins.icqq.password` | string | 否 | — | QQ 密码（可选，不填则扫码登录） |
| `plugins.icqq.platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | 否 | `1` | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `plugins.icqq.ver` | string | 否 | — | 协议版本号，仅在对应 platform 有多个版本时有效，不填则使用最新版本 |
| `plugins.icqq.signApiAddr` | string | 否 | — | 签名服务器地址；未配置时若安装了 @icqqjs/qqsign 则自动使用本地签名 |
| `plugins.icqq.dataDir` | string | 否 | — | 数据存储文件夹路径，默认为主模块下的 data 文件夹 |
| `plugins.icqq.autoReconnect` | boolean | 否 | `true` | 断线后是否自动重连（默认 true） |
| `plugins.icqq.outboundMedia` | string: `"file"`, `"base64"` | 否 | `"file"` | 出站媒体模式：file=落盘本地路径（默认）; base64=CQ base64:// 内联 |
| `plugins.icqq.ignoreSelf` | boolean | 否 | `true` | 群聊和频道中是否过滤自己的消息（默认 true） |
| `plugins.icqq.resend` | boolean | 否 | `false` | 被风控时是否尝试用分片发送（默认 false） |
| `plugins.icqq.cacheGroupMember` | boolean | 否 | `true` | 是否缓存群员列表（默认 true）；群多时（500+）会多占约 100MB+ 内存 |
| `plugins.icqq.autoServer` | boolean | 否 | `true` | 是否自动选择最优服务器（默认 true） |
| `plugins.icqq.qqnt` | boolean | 否 | `true` | 是否使用 QQNT 协议（默认 true） |
| `plugins.icqq.ntLogin` | boolean | 否 | — | 是否使用 NT 登录方式 |
| `plugins.icqq.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.icqq.endpoints[].id` | string | 是 | — | QQ uin |
| `plugins.icqq.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的 master QQ uin；覆盖顶层 master |
| `plugins.icqq.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.icqq.endpoints[].password` | string | 否 | — | 本 endpoint 的 QQ 密码 |
| `plugins.icqq.endpoints[].platform` | number: `1`, `2`, `3`, `4`, `5`, `6`, `7` | 否 | — | 登录设备平台：1=Android, 2=aPad, 3=Watch, 4=iMac, 5=iPad, 6=Tim, 7=Custom |
| `plugins.icqq.endpoints[].ver` | string | 否 | — | 协议版本号 |
| `plugins.icqq.endpoints[].signApiAddr` | string | 否 | — | 签名服务器地址 |
| `plugins.icqq.endpoints[].dataDir` | string | 否 | — | 数据存储文件夹路径 |
| `plugins.icqq.endpoints[].autoReconnect` | boolean | 否 | — | 断线后是否自动重连 |
| `plugins.icqq.endpoints[].outboundMedia` | string: `"file"`, `"base64"` | 否 | — | 出站媒体模式 |
| `plugins.icqq.endpoints[].ignoreSelf` | boolean | 否 | — | 是否过滤自己的消息 |
| `plugins.icqq.endpoints[].resend` | boolean | 否 | — | 被风控时是否分片发送 |
| `plugins.icqq.endpoints[].cacheGroupMember` | boolean | 否 | — | 是否缓存群员列表 |
| `plugins.icqq.endpoints[].autoServer` | boolean | 否 | — | 是否自动选择最优服务器 |
| `plugins.icqq.endpoints[].qqnt` | boolean | 否 | — | 是否使用 QQNT 协议 |
| `plugins.icqq.endpoints[].ntLogin` | boolean | 否 | — | 是否使用 NT 登录方式 |
| `plugins.icqq.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀）。endpoints[i] 可逐项覆盖 |

### kook

[`plugins/adapters/kook/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/kook/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.kook.connection` | string: `"websocket"`, `"webhook"` | 否 | `"websocket"` | WebSocket gateway (default). webhook requires httpHostToken, verify_token, and a public HTTPS callback URL. |
| `plugins.kook.webhookPath` | string | 否 | `"/kook/webhook"` | POST path registered via httpHostToken when connection is webhook. |
| `plugins.kook.data_dir` | string | 否 | — | — |
| `plugins.kook.timeout` | number | 否 | `10000` | — |
| `plugins.kook.max_retry` | number | 否 | `3` | — |
| `plugins.kook.ignore` | string: `"bot"`, `"self"` | 否 | `"bot"` | — |
| `plugins.kook.logLevel` | string: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`, `"mark"`, `"off"` | 否 | `"info"` | — |
| `plugins.kook.master` | string \| number | 否 | — | 框架 master（KOOK user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.kook.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.kook.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.kook.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（KOOK user id）；覆盖顶层 master |
| `plugins.kook.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.kook.endpoints[].token` | string | 是 | — | KOOK bot token |
| `plugins.kook.endpoints[].verify_token` | string | 否 | — | KOOK developer console verify token (required for webhook mode). |
| `plugins.kook.endpoints[].encrypt_key` | string | 否 | — | Optional Encrypt Key when message encryption is enabled in KOOK console. |
| `plugins.kook.endpoints[].id` | string | 是 | — | KOOK bot name |
| `plugins.kook.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### lark

[`plugins/adapters/lark/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/lark/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.lark.webhookPath` | string | 否 | `"/lark/webhook"` | — |
| `plugins.lark.apiBaseUrl` | string | 否 | — | — |
| `plugins.lark.isFeishu` | boolean | 否 | `true` | — |
| `plugins.lark.master` | string \| number | 否 | — | 框架 master（Lark/Feishu open_id or user_id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.lark.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.lark.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.lark.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Lark/Feishu open_id or user_id）；覆盖顶层 master |
| `plugins.lark.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.lark.endpoints[].appId` | string | 是 | — | Lark app ID |
| `plugins.lark.endpoints[].appSecret` | string | 是 | — | Lark app secret |
| `plugins.lark.endpoints[].encryptKey` | string | 否 | — | Lark encrypt key |
| `plugins.lark.endpoints[].verificationToken` | string | 否 | — | Lark verification token |
| `plugins.lark.endpoints[].id` | string | 是 | — | Lark bot name |
| `plugins.lark.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### line

[`plugins/adapters/line/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/line/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.line.webhookPath` | string | 否 | `"/line/webhook"` | — |
| `plugins.line.apiBaseUrl` | string | 否 | `"https://api.line.me"` | — |
| `plugins.line.master` | string \| number | 否 | — | 框架 master（LINE user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.line.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.line.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.line.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（LINE user id）；覆盖顶层 master |
| `plugins.line.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.line.endpoints[].channelSecret` | string | 是 | — | LINE channel secret |
| `plugins.line.endpoints[].channelAccessToken` | string | 是 | — | LINE channel access token |
| `plugins.line.endpoints[].id` | string | 是 | — | LINE bot name |
| `plugins.line.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### milky

[`plugins/adapters/milky/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/milky/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.milky.connection` | string: `"ws"`, `"sse"`, `"webhook"`, `"wss"` | 否 | `"ws"` | ws (default), sse (EventSource client), webhook or wss (webhook/wss via httpHostToken) |
| `plugins.milky.reconnect_interval` | number | 否 | `5000` | — |
| `plugins.milky.heartbeat_interval` | number | 否 | `30000` | — |
| `plugins.milky.master` | string \| number | 否 | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.milky.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.milky.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.milky.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `plugins.milky.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.milky.endpoints[].baseUrl` | string | 是 | — | Milky HTTP API base URL (required); WS event path is derived as ws(s)://host/event |
| `plugins.milky.endpoints[].path` | string | 否 | — | Path for webhook / reverse-wss |
| `plugins.milky.endpoints[].access_token` | string | 否 | — | Milky access token |
| `plugins.milky.endpoints[].id` | string | 是 | — | Milky bot name |
| `plugins.milky.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### napcat

[`plugins/adapters/napcat/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/napcat/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.napcat.connection` | string: `"ws"`, `"wss"`, `"http"` | 否 | `"ws"` | ws (default), wss (reverse WS), or http (POST webhook + HTTP API outbound) |
| `plugins.napcat.reconnect_interval` | number | 否 | `5000` | — |
| `plugins.napcat.heartbeat_interval` | number | 否 | `30000` | — |
| `plugins.napcat.poll_interval` | number | 否 | `30000` | — |
| `plugins.napcat.master` | string \| number | 否 | — | 框架 master（QQ uin；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.napcat.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.napcat.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.napcat.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（QQ uin）；覆盖顶层 master |
| `plugins.napcat.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.napcat.endpoints[].url` | string | 否 | — | NapCat WebSocket URL (required for connection: ws) |
| `plugins.napcat.endpoints[].path` | string | 否 | — | WS path for reverse-wss |
| `plugins.napcat.endpoints[].http_url` | string | 否 | — | HTTP API base URL (connection: http outbound) |
| `plugins.napcat.endpoints[].post_path` | string | 否 | — | HTTP POST event path (connection: http inbound) |
| `plugins.napcat.endpoints[].access_token` | string | 否 | — | NapCat access token |
| `plugins.napcat.endpoints[].id` | string | 是 | — | NapCat bot name |
| `plugins.napcat.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot11

[`plugins/adapters/onebot11/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot11/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.onebot11.connection` | string: `"ws"`, `"wss"` | 否 | `"ws"` | connection: ws (forward WS client, default) or wss (reverse WS via httpHostToken) |
| `plugins.onebot11.reconnect_interval` | number | 否 | `5000` | — |
| `plugins.onebot11.heartbeat_interval` | number | 否 | `30000` | — |
| `plugins.onebot11.master` | string \| number | 否 | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.onebot11.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.onebot11.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.onebot11.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `plugins.onebot11.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.onebot11.endpoints[].url` | string | 否 | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `plugins.onebot11.endpoints[].path` | string | 否 | — | WS path for reverse-wss (connection: wss) |
| `plugins.onebot11.endpoints[].access_token` | string | 否 | — | OneBot access token |
| `plugins.onebot11.endpoints[].id` | string | 是 | — | OneBot11 bot name |
| `plugins.onebot11.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### onebot12

[`plugins/adapters/onebot12/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/onebot12/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.onebot12.connection` | string: `"ws"`, `"webhook"`, `"wss"` | 否 | `"ws"` | ws (default), webhook (httpHostToken POST), or wss (reverse WS via httpHostToken) |
| `plugins.onebot12.reconnect_interval` | number | 否 | `5000` | — |
| `plugins.onebot12.heartbeat_interval` | number | 否 | `30000` | — |
| `plugins.onebot12.master` | string \| number | 否 | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.onebot12.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.onebot12.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.onebot12.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `plugins.onebot12.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.onebot12.endpoints[].url` | string | 否 | — | OneBot implementation WebSocket URL (required for connection: ws) |
| `plugins.onebot12.endpoints[].path` | string | 否 | — | HTTP/WS path for webhook or reverse-wss |
| `plugins.onebot12.endpoints[].api_url` | string | 否 | — | HTTP action endpoint for webhook outbound (required for connection: webhook send) |
| `plugins.onebot12.endpoints[].access_token` | string | 否 | — | OneBot access token |
| `plugins.onebot12.endpoints[].id` | string | 是 | — | OneBot12 bot name |
| `plugins.onebot12.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### qq

[`plugins/adapters/qq/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/qq/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.qq.mode` | string: `"websocket"`, `"webhook"`, `"middleware"` | 否 | `"websocket"` | WebSocket gateway (default). webhook/middleware use httpHostToken POST. |
| `plugins.qq.sandbox` | boolean | 否 | `false` | — |
| `plugins.qq.botKind` | string: `"public"`, `"private"` | 否 | `"public"` | 公域/私域：均含 GROUP_AND_C2C_EVENT；频道消息分别为 PUBLIC_GUILD_MESSAGES / GUILD_MESSAGES。未显式配置 intents 时按此展开 |
| `plugins.qq.master` | string \| number | 否 | — | 框架 master（endpoint 管理命令、AI/工具权限）；openid。endpoints[i].master 可逐项覆盖 |
| `plugins.qq.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.qq.intents` | array&lt;string&gt; | 否 | — | WebSocket Identify intents；省略时按 botKind 自动生成（public→含 PUBLIC_GUILD_MESSAGES） |
| `plugins.qq.accessTokenUrl` | string | 否 | — | — |
| `plugins.qq.gatewayUrl` | string | 否 | — | — |
| `plugins.qq.webhookPath` | string | 否 | `"/qq/webhook"` | POST path on httpHostToken for webhook/middleware modes. |
| `plugins.qq.port` | number | 否 | — | Legacy standalone webhook port (unused with httpHostToken). |
| `plugins.qq.path` | string | 否 | — | Legacy standalone webhook path (unused with httpHostToken). |
| `plugins.qq.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.qq.endpoints[].appid` | string | 是 | — | QQ official bot app ID |
| `plugins.qq.endpoints[].secret` | string | 是 | — | QQ official bot secret |
| `plugins.qq.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（openid）；覆盖顶层 master |
| `plugins.qq.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.qq.endpoints[].botKind` | string: `"public"`, `"private"` | 否 | — | 覆盖顶层 botKind（公域/私域），用于按 endpoint 生成 intents |
| `plugins.qq.endpoints[].intents` | array&lt;string&gt; | 否 | — | 覆盖顶层 intents |
| `plugins.qq.endpoints[].id` | string | 是 | — | QQ bot name |
| `plugins.qq.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### sandbox

[`plugins/adapters/sandbox/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/sandbox/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.sandbox.master` | string \| number | 否 | — | 框架 master（sandbox client id (distinct from endpoints[].owner)；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.sandbox.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.sandbox.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.sandbox.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（sandbox client id (distinct from endpoints[].owner)）；覆盖顶层 master |
| `plugins.sandbox.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.sandbox.endpoints[].context` | string | 否 | — | Sandbox context identifier |
| `plugins.sandbox.endpoints[].owner` | string | 否 | — | Sandbox owner user ID |
| `plugins.sandbox.endpoints[].id` | string | 是 | — | Sandbox bot name |
| `plugins.sandbox.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### satori

[`plugins/adapters/satori/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/satori/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.satori.connection` | string: `"ws"`, `"webhook"` | 否 | `"ws"` | ws (default) or webhook (httpHostToken POST route) |
| `plugins.satori.heartbeat_interval` | number | 否 | `10000` | WS PING interval in milliseconds |
| `plugins.satori.master` | string \| number | 否 | — | 框架 master（platform user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.satori.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.satori.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.satori.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（platform user id）；覆盖顶层 master |
| `plugins.satori.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.satori.endpoints[].baseUrl` | string | 是 | — | Satori SDK HTTP/WS base URL (e.g. http://127.0.0.1:5140) |
| `plugins.satori.endpoints[].token` | string | 否 | — | Bearer token for API and WS IDENTIFY |
| `plugins.satori.endpoints[].path` | string | 否 | — | Webhook POST path (connection: webhook) |
| `plugins.satori.endpoints[].id` | string | 是 | — | Satori bot name |
| `plugins.satori.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### slack

[`plugins/adapters/slack/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/slack/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.slack.socketMode` | boolean | 否 | `true` | Prefer Socket Mode (default). Set false for HTTP Events via httpHostToken. |
| `plugins.slack.webhookPath` | string | 否 | `"/slack/events"` | — |
| `plugins.slack.clientPingTimeout` | number | 否 | `15000` | Socket Mode client ping timeout (ms) |
| `plugins.slack.master` | string \| number | 否 | — | 框架 master（Slack user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.slack.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.slack.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.slack.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Slack user id）；覆盖顶层 master |
| `plugins.slack.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.slack.endpoints[].token` | string | 是 | — | Bot User OAuth Token (xoxb-...) |
| `plugins.slack.endpoints[].signingSecret` | string | 否 | — | Required for HTTP Events API (socketMode: false) |
| `plugins.slack.endpoints[].appToken` | string | 否 | — | App-Level Token (xapp-...) for Socket Mode |
| `plugins.slack.endpoints[].id` | string | 是 | — | Slack bot name |
| `plugins.slack.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### telegram

[`plugins/adapters/telegram/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/telegram/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.telegram.polling` | boolean | 否 | `true` | Long-poll getUpdates (default). Set false for webhook via httpHostToken. |
| `plugins.telegram.webhook` | object | 否 | — | Webhook settings when polling is false. |
| `plugins.telegram.webhook.domain` | string | 否 | — | — |
| `plugins.telegram.webhook.path` | string | 否 | `"/telegram/webhook"` | — |
| `plugins.telegram.webhook.secretToken` | string | 否 | — | Verified via X-Telegram-Bot-Api-Secret-Token. |
| `plugins.telegram.allowedUpdates` | array&lt;string&gt; | 否 | `["message","callback_query"]` | — |
| `plugins.telegram.apiBaseUrl` | string | 否 | `"https://api.telegram.org"` | — |
| `plugins.telegram.master` | string \| number | 否 | — | 框架 master（Telegram user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.telegram.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.telegram.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.telegram.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Telegram user id）；覆盖顶层 master |
| `plugins.telegram.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.telegram.endpoints[].token` | string | 是 | — | Telegram bot token |
| `plugins.telegram.endpoints[].id` | string | 是 | — | Telegram bot name |
| `plugins.telegram.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wechat-mp

[`plugins/adapters/wechat-mp/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wechat-mp/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.wechat-mp.path` | string | 否 | `"/wechat/webhook"` | — |
| `plugins.wechat-mp.encrypt` | boolean | 否 | `false` | — |
| `plugins.wechat-mp.encryptMode` | string: `"plain"`, `"compatible"`, `"secure"` | 否 | — | Default follows encrypt: 'plain' when encrypt=false, 'compatible' when encrypt=true |
| `plugins.wechat-mp.replyMode` | string: `"passive"`, `"customer_service"` | 否 | `"passive"` | — |
| `plugins.wechat-mp.passiveReplyTimeoutMs` | number | 否 | `4500` | — |
| `plugins.wechat-mp.master` | string \| number | 否 | — | 框架 master（WeChat OpenID；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.wechat-mp.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.wechat-mp.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.wechat-mp.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（WeChat OpenID）；覆盖顶层 master |
| `plugins.wechat-mp.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.wechat-mp.endpoints[].appId` | string | 是 | — | WeChat MP app ID |
| `plugins.wechat-mp.endpoints[].appSecret` | string | 是 | — | WeChat MP app secret |
| `plugins.wechat-mp.endpoints[].token` | string | 是 | — | WeChat MP callback token |
| `plugins.wechat-mp.endpoints[].encodingAESKey` | string | 否 | — | WeChat MP encoding AES key |
| `plugins.wechat-mp.endpoints[].id` | string | 是 | — | WeChat MP bot name |
| `plugins.wechat-mp.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### wecom

[`plugins/adapters/wecom/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/wecom/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.wecom.webhookPath` | string | 否 | `"/wecom/callback"` | — |
| `plugins.wecom.apiBaseUrl` | string | 否 | `"https://qyapi.weixin.qq.com"` | — |
| `plugins.wecom.master` | string \| number | 否 | — | 框架 master（WeCom userid；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.wecom.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.wecom.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.wecom.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（WeCom userid）；覆盖顶层 master |
| `plugins.wecom.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.wecom.endpoints[].corpId` | string | 是 | — | WeCom corp ID |
| `plugins.wecom.endpoints[].agentSecret` | string | 是 | — | WeCom agent secret |
| `plugins.wecom.endpoints[].token` | string | 是 | — | WeCom callback token |
| `plugins.wecom.endpoints[].encodingAESKey` | string | 是 | — | WeCom encoding AES key |
| `plugins.wecom.endpoints[].id` | string | 是 | — | WeCom bot name |
| `plugins.wecom.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### weixin-ilink

[`plugins/adapters/weixin-ilink/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/weixin-ilink/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.weixin-ilink.botAgent` | string | 否 | — | — |
| `plugins.weixin-ilink.baseUrl` | string | 否 | `"https://ilinkai.weixin.qq.com"` | — |
| `plugins.weixin-ilink.cdnBaseUrl` | string | 否 | `"https://novac2c.cdn.weixin.qq.com/c2c"` | — |
| `plugins.weixin-ilink.longPollTimeoutMs` | number | 否 | `35000` | — |
| `plugins.weixin-ilink.master` | string \| number | 否 | — | 框架 master（Weixin user id；AI/工具权限、endpoint 管理）。endpoints[i].master 可逐项覆盖 |
| `plugins.weixin-ilink.trusted` | array&lt;string \| number&gt; | 否 | — | 框架 trusted 用户列表（弱于 master）。endpoints[i].trusted 可逐项追加 |
| `plugins.weixin-ilink.endpoints` | array&lt;object&gt; | 是 | — | 多账号：一个插件实例挂多个 endpoint。每项与顶层字段同构（id 必填，其余覆盖顶层） |
| `plugins.weixin-ilink.endpoints[].master` | string \| number | 否 | — | 本 endpoint 的框架 master（Weixin user id）；覆盖顶层 master |
| `plugins.weixin-ilink.endpoints[].trusted` | array&lt;string \| number&gt; | 否 | — | 本 endpoint 的 trusted 列表 |
| `plugins.weixin-ilink.endpoints[].botToken` | string | 是 | — | iLink bot token (prefer env WEIXIN_ILINK_TOKEN or sidecar credential file) |
| `plugins.weixin-ilink.endpoints[].id` | string | 是 | — | Weixin iLink bot name |
| `plugins.weixin-ilink.commandPrefix` | string | 否 | `""` | 命令前缀（默认 '' 无前缀，任意文本按命令匹配；如 '/' 要求 / 开头）。endpoints[i] 可逐项覆盖 |

### process-monitor

[`plugins/features/process-monitor/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/features/process-monitor/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.process-monitor.enabled` | boolean | 否 | `true` | 是否启用进程监控 |
| `plugins.process-monitor.notifyOnStart` | boolean | 否 | `true` | 首次启动时通知 |
| `plugins.process-monitor.notifyOnRestart` | boolean | 否 | `true` | 正常重启时通知 |
| `plugins.process-monitor.notifyOnCrash` | boolean | 否 | `true` | 异常崩溃重启时通知 |
| `plugins.process-monitor.notifyChannels` | array&lt;object&gt; | 否 | `[]` | 通知渠道（slice-1 仅 webhook 生效） |
| `plugins.process-monitor.notifyChannels[].type` | string: `"user"`, `"group"`, `"webhook"` | 是 | — | — |
| `plugins.process-monitor.notifyChannels[].target` | string | 是 | — | — |
| `plugins.process-monitor.notifyChannels[].platform` | string | 否 | — | — |

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
| `plugins.activity-feedback.enabled` | boolean | 否 | `true` | — |
| `plugins.activity-feedback.defaults` | object | 否 | — | — |
| `plugins.activity-feedback.platforms` | object | 否 | — | — |
| `plugins.activity-feedback.endpoints` | object | 否 | — | — |
| `plugins.activity-feedback.schedule` | object | 否 | — | — |

### 60s

[`plugins/utils/60s/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/60s/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.60s.apiBase` | string | 否 | `"https://60s.viki.moe"` | 60s API base URL |

### code-runner

[`plugins/utils/code-runner/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/code-runner/schema.json)

_该 Schema 没有声明字段。_

### content-moderation

[`plugins/utils/content-moderation/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/content-moderation/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.content-moderation.enabled` | boolean | 否 | `true` | 总开关 |
| `plugins.content-moderation.onError` | string: `"open"`, `"closed"` | 否 | `"open"` | 审查源失败时的全局默认策略：open=视为通过，closed=视为 critical |
| `plugins.content-moderation.maskChar` | string | 否 | `"*"` | 文本打码字符 |
| `plugins.content-moderation.replyTemplate` | string | 否 | `"消息含不当内容，已拦截。"` | reply 动作时的提示文案 |
| `plugins.content-moderation.masters` | array&lt;string&gt; | 否 | `[]` | 额外视为 master 的 userId（兜底，与 endpoint master 合并） |
| `plugins.content-moderation.inbound` | object | 否 | — | — |
| `plugins.content-moderation.inbound.enabled` | boolean | 否 | `true` | — |
| `plugins.content-moderation.inbound.bypassMasters` | boolean | 否 | `true` | master 跳过入站审查 |
| `plugins.content-moderation.inbound.whitelist` | object | 否 | — | — |
| `plugins.content-moderation.inbound.whitelist.userIds` | array&lt;string&gt; | 否 | `[]` | — |
| `plugins.content-moderation.inbound.whitelist.conversationIds` | array&lt;string&gt; | 否 | `[]` | — |
| `plugins.content-moderation.outbound` | object | 否 | — | — |
| `plugins.content-moderation.outbound.enabled` | boolean | 否 | `true` | — |
| `plugins.content-moderation.outbound.bypass` | boolean | 否 | `false` | 为 true 时跳过出站审查 |
| `plugins.content-moderation.actions` | object | 否 | — | severity → 动作（字符串或数组）；缺省用偏严默认表 |
| `plugins.content-moderation.actions.pass` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `plugins.content-moderation.actions.low` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `plugins.content-moderation.actions.medium` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `plugins.content-moderation.actions.high` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `plugins.content-moderation.actions.critical` | string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"` \| array&lt;string: `"allow"`, `"log"`, `"reply"`, `"redact"`, `"drop"`, `"recall"`&gt; | 否 | — | — |
| `plugins.content-moderation.sources` | array&lt;object&gt; | 否 | `[]` | — |
| `plugins.content-moderation.sources[].id` | string | 是 | — | — |
| `plugins.content-moderation.sources[].type` | string: `"local"`, `"http"` | 是 | — | — |
| `plugins.content-moderation.sources[].enabled` | boolean | 否 | `true` | — |
| `plugins.content-moderation.sources[].onError` | string: `"open"`, `"closed"` | 否 | — | — |
| `plugins.content-moderation.sources[].includeBuiltin` | boolean | 否 | `true` | 是否合并内置分级违禁词词库 |
| `plugins.content-moderation.sources[].words` | array&lt;string \| object&gt; | 否 | `[]` | 自定义词：字符串（用 defaultSeverity）或 { word, severity } |
| `plugins.content-moderation.sources[].wordFiles` | array&lt;string&gt; | 否 | `[]` | 词库文件；行格式 word / severity:word / word\|severity |
| `plugins.content-moderation.sources[].defaultSeverity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | 否 | `"high"` | 未标注分级的自定义词默认 severity |
| `plugins.content-moderation.sources[].severity` | string: `"low"`, `"medium"`, `"high"`, `"critical"` | 否 | `"high"` | 兼容旧字段，等同 defaultSeverity |
| `plugins.content-moderation.sources[].url` | string | 否 | — | — |
| `plugins.content-moderation.sources[].headers` | object | 否 | — | — |
| `plugins.content-moderation.sources[].timeoutMs` | number | 否 | `5000` | — |
| `plugins.content-moderation.sources[].forceUpload` | boolean | 否 | `false` | 强制下载图片后上传，不传 URL |

### group-suite

[`plugins/utils/group-suite/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.group-suite.keywordReply` | boolean | 否 | `false` | — |
| `plugins.group-suite.basePointsMin` | number | 否 | `10` | — |
| `plugins.group-suite.basePointsMax` | number | 否 | `30` | — |
| `plugins.group-suite.streakBonus` | number | 否 | `5` | — |
| `plugins.group-suite.streakCap` | number | 否 | `50` | — |
| `plugins.group-suite.rankSize` | number | 否 | `10` | — |
| `plugins.group-suite.teachMaxPerGroup` | number | 否 | `200` | — |
| `plugins.group-suite.teachCooldownMs` | number | 否 | `3000` | — |
| `plugins.group-suite.teachAllowRegex` | boolean | 否 | `true` | — |
| `plugins.group-suite.teachPageSize` | number | 否 | `10` | — |

### link-poster

[`plugins/utils/link-poster/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/link-poster/schema.json)

_该 Schema 没有声明字段。_

### lottery

[`plugins/utils/lottery/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/lottery/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.lottery.pickCount` | number | 否 | `5` | — |
| `plugins.lottery.scheduleCron` | string | 否 | `"0 0 18 * * *"` | — |
| `plugins.lottery.historyLimit` | number | 否 | `500` | — |
| `plugins.lottery.scheduleEnabled` | boolean | 否 | `true` | — |
| `plugins.lottery.backtestEnabled` | boolean | 否 | `true` | — |
| `plugins.lottery.backtestWindow` | number | 否 | `50` | — |
| `plugins.lottery.backtestRandomTrials` | number | 否 | `64` | — |
| `plugins.lottery.backtestMinHistory` | number | 否 | `30` | — |
| `plugins.lottery.backtestAdaptive` | boolean | 否 | `true` | — |
| `plugins.lottery.weightPersistEnabled` | boolean | 否 | `true` | — |
| `plugins.lottery.weightHoldoutFallback` | boolean | 否 | `true` | — |
| `plugins.lottery.games` | array&lt;string&gt; | 否 | `["kl8","ssq","dlt","fc3d","pl3","pl5"]` | — |
| `plugins.lottery.pushTargets` | array&lt;object&gt; | 否 | `[]` | OutboundHost push destinations for cron/publish reports |
| `plugins.lottery.pushTargets[].adapter` | string | 是 | — | — |
| `plugins.lottery.pushTargets[].endpointId` | string | 否 | — | — |
| `plugins.lottery.pushTargets[].channelType` | string | 否 | `"private"` | — |
| `plugins.lottery.pushTargets[].channelId` | string | 是 | — | — |
| `plugins.lottery.kl8` | object | 否 | — | — |
| `plugins.lottery.kl8.pickCount` | number | 否 | `5` | — |
| `plugins.lottery.kl8.recommendGroups` | number | 否 | `3` | — |
| `plugins.lottery.kl8.groupStrategies` | array&lt;string&gt; | 否 | `["balanced","hot","cold"]` | — |

### music

[`plugins/utils/music/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/music/schema.json)

_该 Schema 没有声明字段。_

### qrcode

[`plugins/utils/qrcode/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/qrcode/schema.json)

_该 Schema 没有声明字段。_

### repeater

[`plugins/utils/repeater/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/repeater/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.repeater.threshold` | number | 否 | `3` | 触发复读的最少人数 |
| `plugins.repeater.cooldown` | number | 否 | `30000` | 同一群冷却时间 (ms) |
| `plugins.repeater.maxLength` | number | 否 | `200` | 消息长度上限 |

### rss

[`plugins/utils/rss/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/rss/schema.json)

| 路径 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `plugins.rss.pollCron` | string | 否 | `"0 */5 * * * *"` | 轮询频率 (6 段 Cron 表达式) |
| `plugins.rss.maxPerGroup` | number | 否 | `30` | — |
| `plugins.rss.maxItems` | number | 否 | `5` | — |
| `plugins.rss.timeout` | number | 否 | `15000` | — |

### short-url

[`plugins/utils/short-url/schema.json`](https://github.com/zhinjs/zhin/blob/main/plugins/utils/short-url/schema.json)

_该 Schema 没有声明字段。_
