---
"@zhin.js/workroom": patch
---

新增 Room / Member / Role 定义类型与 fail-closed 校验 `validateRoomDefinitions`（与旧 Workroom Catalog 并存，不改变旧行为）。

会话归属以 adapter:kind:id 为键（不含 endpoint），成员 Bot 的 adapter 必须与 Room 会话一致，agent 名大小写不敏感唯一。
