---
"@zhin.js/workroom": patch
---

修正 `RoomTaskExecuteInput` 类型：对 `RoomTaskCommand` 联合类型做分配式 `Omit`，使 `execute()` 在 `tsc` 下可以传入各命令自己的字段（`result` / `to` / `title` 等），而不再退化为只含公共字段。仅类型修正，无运行期变更。
