---
"@zhin.js/agent": minor
"zhin.js": minor
---

Remove process-global prompt, instruction, bootstrap, and Git status caches. Context readers now observe the current workspace on every request without cross-owner state or cache-reset APIs.
