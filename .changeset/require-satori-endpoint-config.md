---
"@zhin.js/adapter-satori": minor
---

Require the canonical expanded Satori endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity, base URL, and token from `process.env`. The public config type is now `SatoriEndpointConfig`, and each schema entry uses `id` as its identity.
