---
"@zhin.js/workroom": patch
---

新增 Room Task 事件溯源状态机（`created → assigned → in_progress → done / blocked / cancelled`，外加 `handoff`）、内存与 `@zhin.js/database` 两种 journal，以及串行化的命令服务 `createRoomTaskService`。

与旧 Workroom 并存，尚未接入运行时；表 `room_task_events` 尚未自动注册（`defineRoomTaskDatabaseModel` 由 C1 接线）。
