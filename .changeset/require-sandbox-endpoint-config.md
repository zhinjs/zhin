---
"@zhin.js/adapter-sandbox": patch
---

Require the canonical expanded Sandbox endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity and owner from `process.env`; the empty-endpoint local development path keeps explicit stable defaults.
