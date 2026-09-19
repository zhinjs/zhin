---
"@zhin.js/adapter-discord": minor
---

Require the canonical expanded Discord endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity and token from `process.env`. The public config type is now `DiscordEndpointConfig`, and each schema entry uses `id` as its identity.
