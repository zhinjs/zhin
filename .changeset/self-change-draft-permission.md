---
"@zhin.js/tool": patch
---

`ToolAvailabilityContext` now carries the optional turn `principal` (`subjectId` + `roles`), so `isAvailable` can hide a tool from requesters who may never call it (#1051 F4: `change_draft` is shown only to the bot owner and IM approvers).
