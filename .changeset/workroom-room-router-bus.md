---
"@zhin.js/core": patch
"@zhin.js/workroom": patch
---

Room Router 与 Room Bus（B2b）。`@zhin.js/core`：`RoomMembershipPort` 新增可选 `route(input)`，必须与 `hasRoom` 成对实现（同步、无副作用，按消息缓存决策，返回目标 Endpoint 与按优先级排序的 `fallbackEndpointIds`）；Room 会话中处理消息的目标 Endpoint 改由 Router 决定，目标副本强制 `mentioned=true`，其余副本只记录。core 无法预知哪个 Endpoint 会收到副本（例如隐私模式），目标没收到副本时，非目标成员副本在宽限期（默认 2s）后按 fallback 优先级接管，保证消息恰好处理一次、不静默丢失；`route` 抛错退化为先到先得。带 action 段的平台按钮回调只由接收它的 Endpoint 处理，绕过 Room 路由和去重；无消息 id / 无发送者 / 私聊（unkeyed）保持逐 Endpoint 处理；待回答探测仅在本条消息能解析到该 Endpoint 的按钮或有该发送者的待回答 claim 时为 true。没有 `route` 时保持 B2 的先到先得去重。`ImRuntimeOptions` 新增 `inboundClaimPending`。`@zhin.js/workroom`：新增 Room Registry、Room Router（待回答 > @ > 回复 > coordinator > 按角色匹配，@alias 使用 Unicode 边界）、`createRoomMembershipPort`、Room Bus（handoff 事件 + 经正常发送链的群内可见投影）。
