# 机器人管理页功能清单

本文档对照「Web 控制台机器人管理页」的实现与计划，标出已完成项与可选增强。

## 一、已完成（核心流程）

| 序号 | 功能 | 说明 | 位置 |
|------|------|------|------|
| 1 | 入口与路由 | 从 /endpoints 卡片进入 Endpoint 管理页 `/endpoints/:adapter/:endpointId` | main.tsx, endpoints.tsx |
| 2 | 全量 WS 协议 | 所有操作走 WebSocket，无 REST | websocket.ts, endpoint-detail.tsx |
| 3 | Endpoint 列表 | `endpoint.list` 拉取并展示 | websocket.ts, endpoints.tsx |
| 4 | Endpoint 信息 | `endpoint.info` 展示名称、适配器、在线状态 | endpoint-detail.tsx |
| 5 | 发送消息 | `endpoint.send_message`，选会话后发私聊/群/频道 | endpoint-detail.tsx |
| 6 | 好友列表 | `endpoint.friends`（icqq），侧栏会话列表 | websocket.ts, endpoint-detail.tsx |
| 7 | 群列表 | `endpoint.groups`（icqq），侧栏会话列表 | websocket.ts, endpoint-detail.tsx |
| 8 | 待处理请求 | `request.list` + 实时推送 `request.receive`，同意/拒绝/标记已处理 | endpoint-hub, websocket, endpoint-detail |
| 9 | 通知 | 实时推送 `notice.receive` + 补发，标记已读 `notice.consumed` | endpoint-hub, websocket, endpoint-detail |
| 10 | 请求持久化与补发 | 存表/JSON，连接时补发未消费请求与通知 | endpoint-persistence, endpoint-hub, endpoint-db-models |
| 11 | 群成员 | `endpoint.group_members`（icqq） | websocket.ts, endpoint-detail.tsx |
| 12 | 群管操作 | `endpoint.group_kick` / `endpoint.group_mute` / `endpoint.group_admin`（icqq） | websocket.ts, endpoint-detail.tsx |
| 13 | Sandbox 风格 UI | 左侧会话/请求/通知 + 右侧主区（发消息/请求/通知/群管） | endpoint-detail.tsx, style.css |
| 14 | Sandbox 页请求与通知 | 沙盒侧栏增加「请求」「通知」入口与空状态说明 | Sandbox.tsx |
| 15 | 列表页待处理角标 | `endpoint.list` 返回每 Endpoint 的 pendingRequestCount/pendingNoticeCount，卡片展示「N 条待处理」；轮询 8s，提供刷新按钮 | websocket.ts, endpoints.tsx |
| 16 | 详情页消息历史 | 当前会话拉取 `inbox.messages`，与实时推送合并展示，支持「加载更多历史消息」 | endpoint-detail.tsx, websocket.ts |
| 17 | 请求/通知历史 Tab | 请求面板「待处理」|「历史」、通知面板「未读」|「历史」；历史 Tab 分页拉取 `inbox.requests` / `inbox.notices`，只读展示 | endpoint-detail.tsx, websocket.ts |

## 二、已实现（原“后端已支持、前端未用”）

| 序号 | 功能 | 说明 |
|------|------|------|
| 1 | 频道列表 `endpoint.channels` | icqq 与 qq 适配器均支持；每项含 `parent: { type: "guild", id, name? }`；qq 用 getGuilds+getChannels，icqq 用 getGuildChannelList |

## 三、已实现（原“未实现/可选增强”）

| 序号 | 功能 | 说明 |
|------|------|------|
| 1 | 收消息展示 | 服务端在各适配器 message.receive 时广播 `message.receive`，前端监听并展示在当前会话消息流中 |
| 2 | 好友管理 | `endpoint.delete_friend`（`$adapter`、`$endpoint`、`$user_id`）；icqq 支持时调用 bot.deleteFriend，前端私聊会话顶栏提供「删除好友」按钮 |
| 3 | 多适配器群管 | 后端按 adapter 动态 inject 并调用 listMembers/kickMember/muteMember/setAdmin，前端成员列表兼容不同字段（user_id/id, nickname/name, role） |

## 四、统一收件箱历史（可选，依赖 zhin `inbox.enabled` + database）

当 zhin 主包启用统一收件箱（`inbox.enabled` 且配置 database）时，控制台可查询历史数据：

| WS 类型 | 说明 |
|--------|------|
| `inbox.messages` | 按会话分页拉取历史消息，请求：`$adapter`, `$endpoint`, `$channel_id`, `$channel_type`, `$limit`, 可选 `$before_ts`/`$before_id`、`$parent`（guild 过滤） |
| `inbox.requests` | 分页拉取请求历史（只读），请求：`$adapter`, `$endpoint`, `$limit`, `$offset` |
| `inbox.notices` | 分页拉取通知历史（只读），请求：`$adapter`, `$endpoint`, `$limit`, `$offset` |

- 未启用收件箱或表不存在时，上述接口返回空数组或 `inboxEnabled: false`，前端不报错。
- 详情页「当前会话」支持加载更多历史消息（与实时推送合并展示）；「请求」「通知」面板增加「历史」Tab，只读展示分页历史。

## 五、列表页待处理角标

- `endpoint.list` 响应中每个 Endpoint 包含 `pendingRequestCount`、`pendingNoticeCount`（来自控制台自有表未消费条数）。
- 列表卡片在「点击进入管理」旁展示「N 条待处理」角标（N = 待处理请求 + 待处理通知），便于快速发现待办。
- 轮询间隔可设为 8–10s，并提供「刷新」按钮。

## 六、WS 消息类型速查

### 客户端 → 服务端（RPC）

管理类请求 `data` 使用 `$foo_bar` 字段；响应使用 snake_case 语义键（无 `$`）。

- `endpoint.list` | `endpoint.info` | `endpoint.send_message`
- `endpoint.friends` | `endpoint.groups` | `endpoint.channels` | `endpoint.delete_friend`
- `request.list` | `request.approve` | `request.reject` | `request.consumed` | `notice.consumed`
- `endpoint.group_members` | `endpoint.group_kick` | `endpoint.group_mute` | `endpoint.group_admin`
- `inbox.messages` | `inbox.requests` | `inbox.notices`

常量 SSOT：`@zhin.js/contract` 导出 `ENDPOINT_RPC`、`SIDE_EVENT_RPC`、`INBOX_RPC`。

### 服务端 → 客户端（推送）

推送载荷使用 `$foo_bar`（与 Plugin Notice/Request 对象同形）：

- `request.receive` — `$row_id`, `$id`, `$adapter`, `$endpoint`, `$type`, `$sub_type`, `$actor`, `$comment`, `$channel`, `$timestamp`, `$can_act`
- `notice.receive` — `$row_id`, `$id`, `$adapter`, `$endpoint`, `$type`, `$sub_type`, `$channel`, `$actor`, `$target`, `$raw_payload`, `$timestamp`
- `message.receive` — `$adapter`, `$endpoint`, `$channel`, `$sender`, `$content`, `$timestamp`（Message 域保留 `$sender`）
- `endpoint.lifecycle` — `$adapter`, `$endpoint`, `$kind`, `$error?`, `$phase?`, `$detail?`

通过 `zhin-console-bot-push` 自定义事件分发。

### Side Event `$type` 命名空间

- Notice：`notice.{domain}.{action}`，如 `notice.group.member_increase`、`notice.friend.increase`
- Request：`request.{domain}.{action}`，如 `request.friend.add`、`request.group.add`

## 七、相关文件

- 服务端：`src/websocket.ts`、`src/endpoint-hub.ts`、`src/endpoint-persistence.ts`、`src/endpoint-db-models.ts`、`src/rpc/handlers-core.ts`
- 控制台客户端：`packages/console/client/client/websocket/manager.ts`、`packages/console/client/client/persistence/idb-store.ts`
- 契约常量：`packages/console/contract/src/constants.ts`
- 前端页面（Remote UI）：`client/src/pages/endpoints.tsx`、`client/src/pages/endpoint-detail.tsx`
