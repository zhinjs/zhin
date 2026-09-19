---
"@zhin.js/core": minor
"zhin.js": minor
---

Remove the closed classic Core Plugin runtime, its duplicate dispatcher and inbound pipeline, and the public types that only described those dead paths. Handler authoring now derives canonical IM event types directly from the generation-owned Runtime contract.
