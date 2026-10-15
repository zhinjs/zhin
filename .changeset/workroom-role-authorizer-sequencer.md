---
"@zhin.js/workroom": patch
---

新增 `createRoomRoleAuthorizer` / `createRoomRoleAssignAuthorizer`（基于 RoomDefinition 的角色授权，fail-closed，可作为 `createRoomTaskAuthorizer` 的 `next` / `authorizeAssign`）与 `createRoomEventSequencer`（订阅者按 `event.sequence` 排序、去重的水位 helper）。
