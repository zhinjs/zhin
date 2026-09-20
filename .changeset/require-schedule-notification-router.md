---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Require the composition root to inject one `NotificationRouter` into Schedule execution and delivery. Remove the duplicate `resolveAdapter` construction path and the Task Executor adapter resolver exposure so scheduled output has one outbound routing authority.
