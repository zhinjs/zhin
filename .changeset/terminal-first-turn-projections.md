---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

Commit the durable Agent terminal before conversation, session, metrics, and IM
reply projections. Projection failures are isolated diagnostics and cannot
rewrite the committed `TurnOutcome`.
