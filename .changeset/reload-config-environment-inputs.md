---
"@zhin.js/plugin-runtime": patch
"@zhin.js/config-file": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/client": patch
---

Classify watched Root configuration changes by their actual Host and Plugin projections, reload only affected Plugin subtrees, and request a process restart for Host configuration changes. Reload project dotenv layers as Runtime inputs so environment references are re-expanded without mutating global process state.
