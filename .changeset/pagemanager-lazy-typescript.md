---
"@zhin.js/pagemanager": patch
---

Load the optional TypeScript compiler only when Page/Layout source metadata is parsed. Allow pure JavaScript CLI projects without client pages to start without TypeScript, and report an explicit optional-peer installation error when compilation is requested.
