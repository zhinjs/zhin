---
"@zhin.js/core": patch
---

`RoomMembershipPort` 新增可选 `hasRoom(conversation)`：返回 true 时，同一会话的多个 Endpoint 收到的同一条人类消息（按平台+会话+发送者+消息 id）只路由一次，其余只记录；不实现 `hasRoom`（目前没有实现）则行为不变，普通群、私聊、无消息 id 的消息仍由每个 Endpoint 各自处理。去重判定出错时 fail-closed：记录并 publish、告警、不路由。
