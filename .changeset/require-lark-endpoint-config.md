---
"@zhin.js/adapter-lark": patch
---

Require the canonical expanded Lark endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity and app credentials from `process.env`. The public config type is now `LarkEndpointConfig`, and each schema entry uses `id` as its identity.
