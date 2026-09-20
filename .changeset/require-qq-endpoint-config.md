---
"@zhin.js/adapter-qq": patch
---

Require the canonical expanded QQ endpoint configuration. The QQ protocol no longer reinterprets a nested `endpoints` array, reads credentials or identity directly from `process.env`, or accepts unused standalone webhook `port` and `path` fields. The public endpoint config type is now `QqEndpointConfig`, and each schema entry uses `id` as its identity.
