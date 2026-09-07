---
"@zhin.js/adapter-sandbox": patch
---

Keep the Console SDK as a required dependency instead of also declaring it as an optional peer, which could remove it from a clean pnpm installation and prevent page compilation.
