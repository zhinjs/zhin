---
'@zhin.js/core': minor
'@zhin.js/agent': minor
'zhin.js': minor
---

Remove the unmounted classic Database Feature, its `defineModel` extension, and the process-global post-start migration hook. Database tables and lifecycle now have one authority through the generation-owned Database Host. Also remove the inactive online `bot_id` compatibility migration; supported schemas must use `endpoint_id` directly.
