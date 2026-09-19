---
"@zhin.js/adapter-kook": minor
---

Require the canonical expanded KOOK endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity, credentials, webhook verification, encryption, and path values from `process.env`. The public config type is now `KookEndpointConfig`, and each schema entry uses `id` as its identity.
