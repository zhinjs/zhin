---
"@zhin.js/core": patch
---

Move conversational claims, typed question sequences, action routing, and keyboard fallback state into a dedicated runtime-owned interaction coordinator. `ImRuntime` now delegates interaction behavior instead of implementing a second state machine inside the message gateway.
