---
"@zhin.js/adapter-satori": patch
---

对齐 Satori 的 Friend、reaction 和群成员角色。

**破坏性变更：** `listGroupMembers` 返回的 `roles` 改为 `GuildRole[]`（`{ id, name? }`）。旧 SDK 若仍下发 `string[]`，适配器会收成 `{ id }`。

新增 `friend.list` / `friend.delete` / `friend.approve`（管理端口的 `listFriends`、`deleteFriend`、`approveRequest`、`rejectRequest`）。`friend-request` 进入 `request.receive`，名称是 `request.friend.add`。表态改为 `reaction.create` / `reaction.delete`，参数名是 `emoji_id`。

`@imhelper/satori-v1` 1.0.10 仍把好友列表当成 User，reaction 参数仍叫 `emoji`。这些类型是本地声明。上游 `feat/satori-1.3-alignment` 发版后可以换成官方类型。
