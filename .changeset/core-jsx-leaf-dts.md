---
"@zhin.js/core": patch
---

Keep the published `Keyboard` / `Action` JSX helper declarations on their leaf type module instead of `import("../index.js")`, so consumers of `zhin.js/command` / `zhin.js/adapter` no longer type-check core's full entry (which needs `@zhin.js/ai` and optional database drivers).
