---
"@zhin.js/tool": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
---

Make `@zhin.js/tool` the sole owner of Agent Tool input Schema admission, JSON Schema projection, and pre-execution parsing. Require an object-root JSON Schema or the public Zod 4 `safeParse` plus `toJSONSchema` contract, remove Zod 3 structural compatibility, and delete the duplicate `@zhin.js/core/tool-zod` entry point.
