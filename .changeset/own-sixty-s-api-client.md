---
"@zhin.js/plugin-60s": patch
"@zhin.js/tool": patch
"@zhin.js/agent": patch
---

Make `tools/<name>/index.ts` available to the owner-aware Tool Feature, preserve tool tags and keywords through Agent projection, and replace the 60s plugin's process-global API base registration stack with an owner-scoped `SixtySClient` used by every command and Agent Tool.
