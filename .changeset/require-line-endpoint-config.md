---
"@zhin.js/adapter-line": minor
---

Require the canonical expanded LINE endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity and credentials from `process.env`. The public config type is now `LineEndpointConfig`, and each schema entry uses `id` as its identity.
