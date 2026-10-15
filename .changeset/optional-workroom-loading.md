---
"@zhin.js/cli": patch
---

The CLI now loads `@zhin.js/workroom` optionally. Without it, `zhin runtime start` still starts the Agent and the Console Workroom endpoints return 503. A Workroom that is installed but fails to load or activate (for example a corrupt journal) still refuses startup. `zhin agent workroom|legacy-*` print an install hint when the package is missing.
