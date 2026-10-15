---
"@zhin.js/workroom": patch
---

createRoomRoleAssignAuthorizer now refuses assign for another room id when given a RoomEntry without roomId, and createRoomRoleAuthorizer refuses unknown command types (fail-closed).
