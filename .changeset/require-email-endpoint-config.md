---
"@zhin.js/adapter-email": patch
---

Require the canonical expanded Email endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity from `process.env`. The public config type is now `EmailEndpointConfig`, and the schema now exposes the complete per-endpoint IMAP and command configuration.
