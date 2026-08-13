---
'@zhin.js/ai': major
'@zhin.js/agent': major
---

Make Agent session persistence origin-neutral. `agent_sessions` now stores only Agent session identity and lifecycle metadata; IM platform, endpoint, and scene fields remain exclusively in the IM transcript/session projection. HTTP, A2A, Schedule, and internal Turns can open Agent sessions without fabricating IM identities.
