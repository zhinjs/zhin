---
"@zhin.js/page": patch
"@zhin.js/layout": patch
"@zhin.js/pagemanager": patch
---

fix(console): match Page/Layout projections by `$projection` brand instead of prototype identity, so Console topology no longer comes back empty when the runtime loads feature packages with a `?zhin-generation` query (Sandbox and other plugin pages were missing).
