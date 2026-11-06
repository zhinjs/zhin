---
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/cli": patch
"@zhin.js/command": patch
"@zhin.js/core": patch
"@zhin.js/handler": patch
"@zhin.js/im-contract": patch
"@zhin.js/runtime": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/service-typesafe": patch
"@zhin.js/testing": patch
"zhin.js": patch
---

Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
