---
title: "@zhin.js/adapter-qq"
package: "@zhin.js/adapter-qq"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/qq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/qq/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=8559c59b2655524f -->

# @zhin.js/adapter-qq

Zhin.js QQ 官方机器人适配器（Plugin Runtime），默认通过 **WebSocket Gateway**（`qq-official-bot`）收发消息（无需 host-router / host-http）。

## 功能

- WebSocket Gateway 入站（默认；无需公网 HTTPS / host）
- 解析私聊 / 群 / 频道消息
- 出站 `send({ conversation, payload })` → QQ API（`conversation.kind`/`id`/`parent` 结构化寻址）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Webhook / middleware 模式已实现（经 `httpHostToken` 注册 POST 路由）
- AI `@` 触发标注：群消息（GROUP_AT_MESSAGE_CREATE 仅 @ 时下发）与频道 `mentions[].bot` 会在入站 metadata 标 `mentioned: true`（新 Plugin Runtime 纯文本 content 经 metadata 传递 @）
- 群事件：机器人进群/退群、群成员加入/退出、入群申请（支持 `$approve()` / `$reject()`）
- 群管理（官方 v2 群接口）：成员列表 / 详情、移出（可拉黑）、禁言（≤30 天）、入群申请审批、黑名单查询；Endpoint 管理端口与自动群审核（`inspectGroupMember` / `moderateGroupMember`）可直接使用
- 撤回：自己的消息，以及机器人为群管理员时普通成员 2 分钟内的消息（入站原生消息 ID 也可撤回）
- 频道子频道消息表情回应（`reaction` 操作，Unicode emoji 或 `type:id`）
- 完整 SDK 业务 API：当前消息操作的 `session.endpoint` 就是 `qq-official-bot` 实例，可直接使用群管理、禁言、自动审批策略、自定义菜单和指令面板等原生 Service

## 安装

```bash
pnpm add @zhin.js/adapter-qq
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/qq/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `endpoint[endpointSpec].events` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`
- **无需** `@zhin.js/host-http` / `@zhin.js/host-router`（WebSocket 路径）

入站：`endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })`（ConversationRef 结构化寻址）

出站：`send({ conversation, payload })` → `sendPrivateMessage` / `sendGroupMessage` / `sendGuildMessage`

## 前置条件

| 要求 | 说明 |
|------|------|
| **AppID / Secret** | [QQ 开放平台](https://q.qq.com/) 创建机器人应用并获取 |
| **WebSocket（默认）** | `qq-official-bot` 正向连接；无需公网回调 |
| **host-http** | WebSocket **不需要**；Webhook / middleware 模式需要（经 `httpHostToken`） |

必填字段（`endpoints[i]`）：`id`、`appid`、`secret`。

## 最小配置

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  qq: "@zhin.js/adapter-qq"
qq:
  # mode: websocket   # 默认
  endpoints:
    - id: my-qq-bot
      appid: ${QQ_APPID}
      secret: ${QQ_SECRET}
      # botKind / intents 可由向导写入；`qq endpoint add` 扫码后会追问公域/私域再写入
```

### botKind 与 intents

WebSocket Identify 的 `intents` **必须与开放平台已开通的权限一致**，否则会断连。
群聊无公/私域之分，两类都订阅 `GROUP_AND_C2C_EVENT` 和 `GROUP_MEMBER`；差异只在频道消息 intent：

| `botKind` | 频道消息 intent | 共用 intents |
|-----------|-----------------|--------------|
| `public`（默认，公域） | `PUBLIC_GUILD_MESSAGES`（仅 @） | `GROUP_AND_C2C_EVENT`, `GROUP_MEMBER`, `GUILDS`, `GUILD_MEMBERS`, `DIRECT_MESSAGE` |
| `private`（私域） | `GUILD_MESSAGES`（频道全量） | 同上 |

公域机器人订阅 `GUILD_MESSAGES` 会 Identify 失败断连。显式配置 `intents` 时优先于 `botKind`。
`create-zhin` / `zhin setup` 会询问公/私域并写入；`qq endpoint add` 扫码成功后在同一会话追问 `public`/`private`（或 `公域`/`私域`），确认后通过所属 Adapter 的单次 CAS 加密保存为未启动账号，需手动启动。

多账号：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`id` 必填）：

```yaml
configVersion: 2
plugins:
  qq: "@zhin.js/adapter-qq"
qq:
  mode: websocket
  endpoints:
    - id: main-bot
      appid: ${QQ_APPID}
      secret: ${QQ_SECRET}
      botKind: public
      intents:
        - GROUP_AND_C2C_EVENT
        - GROUP_MEMBER
        - GUILDS
        - GUILD_MEMBERS
        - DIRECT_MESSAGE
        - PUBLIC_GUILD_MESSAGES
    - id: private-bot
      appid: ${QQ_APPID_2}
      secret: ${QQ_SECRET_2}
      botKind: private
      intents:
        - GROUP_AND_C2C_EVENT
        - GROUP_MEMBER
        - GUILDS
        - GUILD_MEMBERS
        - DIRECT_MESSAGE
        - GUILD_MESSAGES
```

主配置 `plugins` 映射需引用 `@zhin.js/adapter-qq`（`instanceKey: qq`）。

## Endpoint 管理命令

适配器自带 `qq endpoint` 命令组（聊天内直接使用，默认无前缀；受 `commandPrefix` 影响）：

| 命令 | 说明 |
|------|------|
| `qq endpoint add [name]` | 手机 QQ 扫码绑定 → **追问公域/私域** → 一次 CAS 保存为未启动账号（无需重启） |
| `qq endpoint cancel` | 取消进行中的扫码绑定或待确认的公域/私域选择 |
| `qq endpoint list` | 列出运行中与配置中的 endpoints |
| `qq endpoint remove <name>` | 删除账号配置，取消目标在途并关闭，保留历史 |

add/cancel/remove 受 `master` 限制：实例配置声明了 `master`（顶层或 `endpoints[i].master`）时仅
master 可执行；未配置则放行（首个扫码绑定者会写入该 endpoint 的 `master`）。二维码当前以链接文本下发
（出站富媒体待迁移），用手机 QQ 打开链接即可扫码。

## 环境变量

| 变量 | 说明 |
|------|------|
| `QQ_APPID` | YAML 示例中 `appid` 引用的应用 AppID |
| `QQ_SECRET` | YAML 示例中 `secret` 引用的应用 Secret |

## Webhook / middleware

`mode: webhook` 或 `mode: middleware` 经 `httpHostToken` 注册 POST 路由（默认 `/qq/webhook`），使用 qq-official-bot Middleware 接收器验签并入站；出站仍走 QQ HTTP API。Host 需注入 `httpHostToken`。

## AI 工具（Skill）

| 技能 | 工具 | 场景 |
|------|------|------|
| `qq-conversation` | `conversation_info` | 当前会话、机器人实时群角色（`bot_state`）、可用操作与官方限制 |
| `qq-messages` | `quote_reply`、`recall_own_message` | 私聊 / 群 / 频道 |
| `qq-group-directory` | `group_info`、`group_members`、`group_member_info` | 当前群 |
| `qq-group-admin` | `group_kick`、`set_mute`、`recall_member_message`、`handle_join_request` | 当前群（撤回也支持频道） |
| `qq-group-state` | `list_muted`、`list_join_requests`、`group_blacklist` | 当前群 |
| `qq-directory` | `list_guilds` | 任意 |
| `qq` | `list_channels`、`channel_info`、`list_roles`、`create_role`、`add_role`、`remove_role`、`member_detail`、`guild_mute_member`、`guild_kick_member` | 频道 |

群工具只作用于当前会话的群（`group_openid`），成员用 `member_openid` 标识；写操作前实时核验机器人角色。
`group_kick` / `handle_join_request` / `guild_kick_member` 每次人工审批，禁言类每次审批。Permit 词汇见 `PERMITS.md`。

### 与 ICQQ 的对齐情况

| ICQQ 能力 | QQ 官方 | 说明 |
|-----------|---------|------|
| `group_member_info`、`conversation_info`、`quote_reply`、`recall_own_message`、`recall_member_message`、`group_kick`、`set_mute`、`list_muted` | ✅ 对齐 | 官方 v2 群接口；成员 / 移出类为白名单能力（11253） |
| 入群申请审批、Console 成员列表 / 踢人 / 禁言、自动群审核 | ✅ 对齐 | `EndpointManagement` 端口 |
| 表情回应 | ⚠️ 部分 | 仅频道子频道消息；官方无群 / 单聊表情回应 |
| `friend_list`、`group_list`、`user_info` | ❌ 官方不支持 | 无机器人好友 / 群列表、任意用户资料接口 |
| `forward_messages` | ❌ 官方不支持 | 无合并转发发送接口 |
| `poke`、`send_user_like`、`group_sign` | ❌ 官方不支持 | |
| `announce`、`essence`、`set_title`、`set_anonymous`、`group_files`、`group_invite`、`group_leave` | ❌ 官方不支持 | 群公告 / 精华 / 头衔 / 匿名 / 群文件 / 邀请 / 退群均无接口 |
| 设管理员、删好友（Console） | ❌ 官方不支持 | |

## 平台 Client 与 QQ API

在已有消息操作中，`session.endpoint` 是完整的 `qq-official-bot` 1.3 原生 Bot 实例，直接暴露业务 Service 与实体入口；账号连接启停仍通过所属 Adapter 管理：

```ts
// session 来自声明 adapter: 'qq' 的当前消息操作。
const client = session.endpoint;

const group = await client.groupService.getInfo(groupOpenid);
const requests = await client.groupService.getJoinRequests(groupOpenid);
await client.groupService.setMemberMute(groupOpenid, [
  { op: 'add', member_openid: memberOpenid, mute_expire_at: expiresAt },
]);

const menu = await client.menuPanelService.getCustomMenu();
const panels = await client.menuPanelService.getCommandPanels({ scope: 'group' });
```

群管理接口中有部分是白名单能力，入群审批和禁言还要求机器人具备群管理员权限；
具体可用范围以 QQ 开放平台为准。

## 平台权限（platform permit）

platform permit checker 由 `plugin.ts` 的 generation 生命周期注册；`@zhin.js/tool` descriptor 保留 `platforms` / `scopes` / `permissions`，CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 执行门禁。

## Markdown 与交互输出

QQ Endpoint 声明原生 `markdown` / `keyboard` 能力。普通 AI Markdown 会保留为 QQ Markdown
消息；命令或 Agent 通过 `UserInteraction.ask()` 发起 `confirm` / `select` 时，会生成
Markdown + 指令按钮组。按钮值与手动输入共用同一解析入口，不维护 QQ 专用交互状态。

不支持原生按钮的 Adapter 会在 Core 中把同一 keyboard 语义降级为编号列表，并保存数字到
payload 的回跳映射。图片、音频、视频和文件仍沿 canonical `MediaRef` 出站链投递。

## 被动回复与主动消息

QQ 开放平台按有没有带上用户消息的 `msg_id`（或事件的 `event_id`）区分被动回复和主动消息。
主动消息有额度限制，用户还可以在客户端关闭"允许主动发送"。Endpoint 会记录每个会话最近
收到的 `msg_id`，以及按钮回调（`INTERACTION_CREATE`）的 `event_id`，发送时自动带上：

| 场景 | 被动回复有效期 | 每个来源最多回复 |
| --- | --- | --- |
| 群聊 | 5 分钟 | 5 次 |
| 单聊（C2C） | 60 分钟 | 4 次 |
| 频道 / 频道私信 | 5 分钟 | 5 次（平台未公布次数） |

- **怎么选来源**：每条消息取会话里最新的可用来源。payload 里有 `reply` 段时，优先用它指向的消息。快到有效期时（提前 15 秒）就不再使用，`msg_seq` 按来源递增，经 `qq-official-bot` 的 `SendOptions.msgSeq` 传给平台。
- **来源不可用**：平台返回来源过期、次数用完或 msg_id 错误（`40034128`、`40034005`、`304027`、`304026` 等）时，这个来源作废，这条消息改发一次主动消息。
- **结果未知不重发**：超时、断线这类结果未知的情况，不会改发主动消息，因为第一次请求可能已经送达；会报告 `deliveryUnknown`。
- **内容被拒不改发主动**：审核、敏感词等内容类错误照常报失败，不改发主动消息，以免消耗主动额度。
- **主动消息被拒**：平台拒绝主动消息时（无权限 `40034105`、私信已关闭、额度用完等），这个会话 1 小时内不再尝试主动发送，直接报失败。
- **Markdown 没有权限**：平台拒绝 Markdown 时（`304036`、`304014`、`50056`），同一条消息改成纯文本重发，按钮会被去掉。

公域机器人在群里只能收到 @ 它的消息，所以群聊旁听（`ai.trigger.ambient`）只对拥有全量
消息权限的私域机器人有意义。

## Console 页面

启动后打开 Console 的「QQ」页（地址 `/qq`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 在账号库查看、修改、启停、替换或删除 QQ 账号；新增走扫码绑定，保存后需手动启动；
- 「平台操作」里扫码绑定新机器人：扫码 → 选择公域 / 私域 → 通过同一账号 CAS 保存为未启动状态；原来的 `qq endpoint add` 仍然保留。

读取需要 `qq:read`，写操作需要 `qq:write`；管理员 full token 不受限。页面里的「扫码绑定新机器人」等价于原来的 `qq endpoint add`。

首次修改启动配置里的既有账号前，管理员必须核对清单并确认一次迁移。原 canonical 身份与历史保留，完整账号配置加密进入 Host 数据库；此后账号管理只写数据库，不修改启动文件或 `.env`，不重启进程。没有持久化账号端口的环境可使用静态配置连接，动态写操作明确不可用。

启停意图在进程重启后恢复。停止或删除会取消并关闭目标账号的在途操作，其他账号继续运行；删除保留历史。已启动账号的连接配置更新先关闭旧 incarnation，再仅重连该账号；平台身份变化按替换处理，分配新内部身份、保留旧历史，新账号不继承旧 Session、个人设置或启动意图。提交结果未知时先刷新核实，不自动重复 CAS 或平台操作。

## 掉线通知

QQ 官方机器人掉线 / 启动失败时，可以配置 `notify` 让另一个适配器实例通知 master：

```yaml
icqq:
  # ... 已配置好的 ICQQ 实例
qq:
  master: "${QQ_MASTER_OPENID}"
  notify:
    adapter: icqq
    endpoint: "123456"
    kind: private
    id: "123456"   # master 的 QQ 号
```

通知里会提示恢复方式：在 QQ 回复 `qq endpoint add` 重新扫码绑定（或打开 Console 的 QQ 页面）。`notify.id` 同时作为 endpoint 管理命令的 master 身份，方便从通知会话直接完成绑定。未配置 `notify` 时只在日志和 Console 的 QQ 页面显示连接状态。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| Gateway Identify 后断线 | 检查 `botKind` 与 intents；公域机器人不要订阅受限 intent |
| 二维码绑定后仍离线 | 在 Console 登录待办确认结果，并检查 App ID、Secret 与 Token |
| Webhook 无事件 | 检查 HTTP Host、公网路径、平台回调与签名参数 |
| Markdown/按钮发送失败 | 检查平台模板与权限；无权限时 Endpoint 会自动改发纯文本 |
| 日志出现 `qq_active_unavailable` | 该会话拒绝主动消息：让用户打开"允许主动发送"，或等用户再发消息后以被动回复送达 |
| 定时任务、超时通知发不出 | 触发时会话里没有有效期内的 `msg_id`，只能发主动消息；检查主动消息权限与额度 |

## 许可证

MIT License

### 发送回执与未知结果

发送成功回执只接受平台真实消息 ID。网络超时、断线、缺少消息 ID 的响应会报告 `deliveryUnknown`，框架不会自动重发；手动重发可能重复发送。

QQ 返回 `message_audit.audit_id` 仅表示审核任务，不能用作消息 ID，不能据此声明消息已投递。

QQ SDK 启动须在 30 秒内完成，否则端点启动失败并清理该客户端；迟到就绪会再次清理旧客户端。超时不表示凭据错误，应结合网关、认证网络与权限检查。

`qq-official-bot` 1.3.1 已包含 SDK Session.start 的 async Promise executor 修复：认证/接收器启动异常由启动 Promise 正确拒绝，ready 监听先于启动注册，启动结束清理临时监听。已实际验证本机 dummy 403 认证失败经完整 CLI 退出 1，无未处理 rejection；不等价于真实 QQ 账号联网验收。

原生按钮按腾讯协议编码：type=0 URL 跳转、type=1 回调、type=2 指令。默认订阅包含 INTERACTION（1<<26）；用户显式 intents 保留原值，需自行加入 INTERACTION 才能收到回调。SDK notice.*.action 映射为 canonical action，并独立 PUT ACK解除loading；ACK不代表业务处理成功。私聊/群聊平台不提供源消息ID，metadata 明确 sourceMessageIdAvailable=false，以唯一payload、完整端点/会话与操作者关联；频道提供源ID时严格保留。参考：[腾讯官方消息按钮协议](https://github.com/tencent-connect/bot-docs/blob/main/docs/develop/api-v2/server-inter/message/trans/msg-btn.md)。

QQ 当前未实现 canonical `share` 的标题/描述/URL 消息卡片。适配器显式 supported 不含 share，探针及正常统一发送均整体返回 unsupported；不会仅发送旁边的样本文字并记分享成功。直接 endpoint 编码也明确 not_sent，避免绕过能力检查后静默丢失。

分片上传兼容平台返回的完整连续 0-based 或 1-based 序号。字节偏移使用
`(index - base) * block_size`，分片完成通知保留平台原序号；重复、缺片、异常大小或空
分片集合会在 PUT 前拒绝。官方文档示例为 0-based，实机曾返回单片 `index: 1`。
当前官方预上传合同未说明 `parts: []` 是合法秒传响应，因此未将空集合视为已上传；
若后续取得该合同证据，应补独立回归后支持。debug 诊断仅记录数值和匹配状态，SDK
原始 debug 继续关闭，避免输出凭据及上传地址。

### WebSocket 受控故障入口

可选 `streamProxy: { port: 18443, serverName: "实际网关 hostname" }` 将 WSS 的 TCP 连接导向 `127.0.0.1:port`。需代理固定转发到相同官方网关的 443 端口；SDK 每次仍动态调用 `getWsUrl()`，hostname/443 不匹配会拒绝连接并只记录 hostname，不能自动绕过代理。原始 URL、HTTP Host、TLS SNI 保留，证书验证始终开启。不要填带 query 的 URL。

仅 WSS 入站、心跳和会话认证经过此代理；AppSecret 换 token、网关发现 HTTP、消息 API 和媒体上传仍直连。故障恢复由 `createEndpointLifecycle` 负责，SDK 内置重连关闭，避免双重重连。此入口用于受控网络验收，不提供全局代理或 TLS 验证绕过。

## 语言与绑定会话

Endpoint 管理命令和工具反馈使用当前操作语言。扫码绑定在开始时固定语言，后续二维码刷新、公域/私域选择和结果回复保持一致；`public` / `private` 是稳定的配置值，两种语言都可使用，中文别名只在中文流程中接受。

取消指引使用发起命令时的真实前缀及插件命名空间，不猜测调用方式。确认回复仅接受发起者所在的完整会话（Endpoint、会话、父容器、线程和发送者）；其他成员或线程不会完成该绑定。
