# 机器人管理页功能清单

本文档对照「Web 控制台机器人管理页」的实现与计划，标出已完成项与可选增强。

## 一、已完成（核心流程）

| 序号 | 功能 | 说明 | 位置 |
|------|------|------|------|
| 1 | 入口与路由 | 从 /bots 卡片进入机器人管理页 `/bots/:adapter/:botId` | main.tsx, bots.tsx |
| 2 | 全量 WS 协议 | 所有操作走 WebSocket，无 REST | websocket.ts, bot-detail.tsx |
| 3 | 机器人列表 | `bot:list` 拉取并展示 | websocket.ts, bots.tsx |
| 4 | 机器人信息 | `bot:info` 展示名称、适配器、在线状态 | bot-detail.tsx |
| 5 | 发送消息 | `bot:sendMessage`，选会话后发私聊/群/频道 | bot-detail.tsx |
| 6 | 好友列表 | `bot:friends`（icqq），侧栏会话列表 | websocket.ts, bot-detail.tsx |
| 7 | 群列表 | `bot:groups`（icqq），侧栏会话列表 | websocket.ts, bot-detail.tsx |
| 8 | 待处理请求 | `bot:requests` + 实时推送 `bot:request`，同意/拒绝/标记已处理 | bot-hub, websocket, bot-detail |
| 9 | 通知 | 实时推送 `bot:notice` + 补发，标记已读 `bot:noticeConsumed` | bot-hub, websocket, bot-detail |
| 10 | 请求持久化与补发 | 存表/JSON，连接时补发未消费请求与通知 | bot-persistence, bot-hub, bot-db-models |
| 11 | 群成员 | `bot:groupMembers`（icqq） | websocket.ts, bot-detail.tsx |
| 12 | 群管操作 | `bot:groupKick` / `bot:groupMute` / `bot:groupAdmin`（icqq） | websocket.ts, bot-detail.tsx |
| 13 | Sandbox 风格 UI | 左侧会话/请求/通知 + 右侧主区（发消息/请求/通知/群管） | bot-detail.tsx, style.css |
| 14 | Sandbox 页请求与通知 | 沙盒侧栏增加「请求」「通知」入口与空状态说明 | Sandbox.tsx |
| 15 | 列表页待处理角标 | `bot:list` 返回每 bot 的 pendingRequestCount/pendingNoticeCount，卡片展示「N 条待处理」；轮询 8s，提供刷新按钮 | websocket.ts, bots.tsx |
| 16 | 详情页消息历史 | 当前会话拉取 `bot:inboxMessages`，与实时推送合并展示，支持「加载更多历史消息」 | bot-detail.tsx, websocket.ts |
| 17 | 请求/通知历史 Tab | 请求面板「待处理」|「历史」、通知面板「未读」|「历史」；历史 Tab 分页拉取 `bot:inboxRequests` / `bot:inboxNotices`，只读展示 | bot-detail.tsx, websocket.ts |

## 二、已实现（原“后端已支持、前端未用”）

| 序号 | 功能 | 说明 |
|------|------|------|
| 1 | 频道列表 `bot:channels` | 非 icqq 时前端调用并展示频道到侧栏；后端对 qq 适配器用 getGuilds+getChannels 拉取，其他适配器可实现 listChannels 返回 |

## 三、已实现（原“未实现/可选增强”）

| 序号 | 功能 | 说明 |
|------|------|------|
| 1 | 收消息展示 | 服务端在各适配器 message.receive 时广播 `bot:message`，前端监听并展示在当前会话消息流中 |
| 2 | 好友管理 | `bot:deleteFriend`（adapter、botId、userId）；icqq 支持时调用 bot.deleteFriend，前端私聊会话顶栏提供「删除好友」按钮 |
| 3 | 多适配器群管 | 后端按 adapter 动态 inject 并调用 listMembers/kickMember/muteMember/setAdmin，前端成员列表兼容不同字段（user_id/id, nickname/name, role） |

## 四、统一收件箱历史（可选，依赖 zhin `inbox.enabled` + database）

当 zhin 主包启用统一收件箱（`inbox.enabled` 且配置 database）时，控制台可查询历史数据：

| WS 类型 | 说明 |
|--------|------|
| `bot:inboxMessages` | 按会话分页拉取历史消息，参数：adapter, botId, channelId, channelType, limit, 可选 beforeTs/beforeId |
| `bot:inboxRequests` | 分页拉取请求历史（只读），参数：adapter, botId, limit, offset |
| `bot:inboxNotices` | 分页拉取通知历史（只读），参数：adapter, botId, limit, offset |

- 未启用收件箱或表不存在时，上述接口返回空数组或 `inboxEnabled: false`，前端不报错。
- 详情页「当前会话」支持加载更多历史消息（与实时推送合并展示）；「请求」「通知」面板增加「历史」Tab，只读展示分页历史。

## 五、列表页待处理角标

- `bot:list` 响应中每个 bot 包含 `pendingRequestCount`、`pendingNoticeCount`（来自控制台自有表未消费条数）。
- 列表卡片在「点击进入管理」旁展示「N 条待处理」角标（N = 待处理请求 + 待处理通知），便于快速发现待办。
- 轮询间隔可设为 8–10s，并提供「刷新」按钮。

## 六、WS 消息类型速查

- 客户端→服务端：`bot:list` | `bot:info` | `bot:sendMessage` | `bot:friends` | `bot:groups` | `bot:channels` | `bot:deleteFriend` | `bot:requests` | `bot:requestApprove` | `bot:requestReject` | `bot:requestConsumed` | `bot:noticeConsumed` | `bot:groupMembers` | `bot:groupKick` | `bot:groupMute` | `bot:groupAdmin` | `bot:inboxMessages` | `bot:inboxRequests` | `bot:inboxNotices`
- 服务端→客户端（推送）：`bot:request` | `bot:notice` | `bot:message`（通过 `zhin-console-bot-push` 自定义事件分发）

## 七、相关文件

- 服务端：`src/websocket.ts`、`src/bot-hub.ts`、`src/bot-persistence.ts`、`src/bot-db-models.ts`、`src/index.ts`
- 前端：`client/src/pages/bots.tsx`、`client/src/pages/bot-detail.tsx`
- 客户端消息分发：`packages/client/.../messageHandler.ts`（`bot:request` / `bot:notice`）
