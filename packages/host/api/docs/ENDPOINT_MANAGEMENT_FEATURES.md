# 机器人管理页功能清单

本文档对照「Web 控制台机器人管理页」的实现与计划，标出已完成项与可选增强。

## 一、已完成（核心流程）

| 序号 | 功能 | 说明 | 位置 |
|------|------|------|------|
| 1 | 入口与路由 | 从 /endpoints 卡片进入 Endpoint 管理页 `/endpoints/:adapter/:endpointId` | main.tsx, endpoints.tsx |
| 2 | 全量 WS 协议 | 所有操作走 WebSocket，无 REST | websocket.ts, endpoint-detail.tsx |
| 3 | Endpoint 列表 | `endpoint:list` 拉取并展示 | websocket.ts, endpoints.tsx |
| 4 | Endpoint 信息 | `endpoint:info` 展示名称、适配器、在线状态 | endpoint-detail.tsx |
| 5 | 发送消息 | `endpoint:sendMessage`，选会话后发私聊/群/频道 | endpoint-detail.tsx |
| 6 | 好友列表 | `endpoint:friends`（icqq），侧栏会话列表 | websocket.ts, endpoint-detail.tsx |
| 7 | 群列表 | `endpoint:groups`（icqq），侧栏会话列表 | websocket.ts, endpoint-detail.tsx |
| 8 | 待处理请求 | `endpoint:requests` + 实时推送 `endpoint:request`，同意/拒绝/标记已处理 | endpoint-hub, websocket, endpoint-detail |
| 9 | 通知 | 实时推送 `endpoint:notice` + 补发，标记已读 `endpoint:noticeConsumed` | endpoint-hub, websocket, endpoint-detail |
| 10 | 请求持久化与补发 | 存表/JSON，连接时补发未消费请求与通知 | endpoint-persistence, endpoint-hub, endpoint-db-models |
| 11 | 群成员 | `endpoint:groupMembers`（icqq） | websocket.ts, endpoint-detail.tsx |
| 12 | 群管操作 | `endpoint:groupKick` / `endpoint:groupMute` / `endpoint:groupAdmin`（icqq） | websocket.ts, endpoint-detail.tsx |
| 13 | Sandbox 风格 UI | 左侧会话/请求/通知 + 右侧主区（发消息/请求/通知/群管） | endpoint-detail.tsx, style.css |
| 14 | Sandbox 页请求与通知 | 沙盒侧栏增加「请求」「通知」入口与空状态说明 | Sandbox.tsx |
| 15 | 列表页待处理角标 | `endpoint:list` 返回每 Endpoint 的 pendingRequestCount/pendingNoticeCount，卡片展示「N 条待处理」；轮询 8s，提供刷新按钮 | websocket.ts, endpoints.tsx |
| 16 | 详情页消息历史 | 当前会话拉取 `endpoint:inboxMessages`，与实时推送合并展示，支持「加载更多历史消息」 | endpoint-detail.tsx, websocket.ts |
| 17 | 请求/通知历史 Tab | 请求面板「待处理」|「历史」、通知面板「未读」|「历史」；历史 Tab 分页拉取 `endpoint:inboxRequests` / `endpoint:inboxNotices`，只读展示 | endpoint-detail.tsx, websocket.ts |

## 二、已实现（原“后端已支持、前端未用”）

| 序号 | 功能 | 说明 |
|------|------|------|
| 1 | 频道列表 `endpoint:channels` | 非 icqq 时前端调用并展示频道到侧栏；后端对 qq 适配器用 getGuilds+getChannels 拉取，其他适配器可实现 listChannels 返回 |

## 三、已实现（原“未实现/可选增强”）

| 序号 | 功能 | 说明 |
|------|------|------|
| 1 | 收消息展示 | 服务端在各适配器 message.receive 时广播 `endpoint:message`，前端监听并展示在当前会话消息流中 |
| 2 | 好友管理 | `endpoint:deleteFriend`（adapter、endpointId、userId）；icqq 支持时调用 bot.deleteFriend，前端私聊会话顶栏提供「删除好友」按钮 |
| 3 | 多适配器群管 | 后端按 adapter 动态 inject 并调用 listMembers/kickMember/muteMember/setAdmin，前端成员列表兼容不同字段（user_id/id, nickname/name, role） |

## 四、统一收件箱历史（可选，依赖 zhin `inbox.enabled` + database）

当 zhin 主包启用统一收件箱（`inbox.enabled` 且配置 database）时，控制台可查询历史数据：

| WS 类型 | 说明 |
|--------|------|
| `endpoint:inboxMessages` | 按会话分页拉取历史消息，参数：adapter, endpointId, channelId, channelType, limit, 可选 beforeTs/beforeId |
| `endpoint:inboxRequests` | 分页拉取请求历史（只读），参数：adapter, endpointId, limit, offset |
| `endpoint:inboxNotices` | 分页拉取通知历史（只读），参数：adapter, endpointId, limit, offset |

- 未启用收件箱或表不存在时，上述接口返回空数组或 `inboxEnabled: false`，前端不报错。
- 详情页「当前会话」支持加载更多历史消息（与实时推送合并展示）；「请求」「通知」面板增加「历史」Tab，只读展示分页历史。

## 五、列表页待处理角标

- `endpoint:list` 响应中每个 Endpoint 包含 `pendingRequestCount`、`pendingNoticeCount`（来自控制台自有表未消费条数）。
- 列表卡片在「点击进入管理」旁展示「N 条待处理」角标（N = 待处理请求 + 待处理通知），便于快速发现待办。
- 轮询间隔可设为 8–10s，并提供「刷新」按钮。

## 六、WS 消息类型速查

- 客户端→服务端：`endpoint:list` | `endpoint:info` | `endpoint:sendMessage` | `endpoint:friends` | `endpoint:groups` | `endpoint:channels` | `endpoint:deleteFriend` | `endpoint:requests` | `endpoint:requestApprove` | `endpoint:requestReject` | `endpoint:requestConsumed` | `endpoint:noticeConsumed` | `endpoint:groupMembers` | `endpoint:groupKick` | `endpoint:groupMute` | `endpoint:groupAdmin` | `endpoint:inboxMessages` | `endpoint:inboxRequests` | `endpoint:inboxNotices`
- 服务端→客户端（推送）：`endpoint:request` | `endpoint:notice` | `endpoint:message`（通过 `zhin-console-bot-push` 自定义事件分发）

## 七、相关文件

- 服务端：`src/websocket.ts`、`src/endpoint-hub.ts`、`src/endpoint-persistence.ts`、`src/endpoint-db-models.ts`、`src/index.ts`
- 前端：`client/src/pages/endpoints.tsx`、`client/src/pages/endpoint-detail.tsx`
- 客户端消息分发：`packages/client/.../messageHandler.ts`（`endpoint:request` / `endpoint:notice`）
