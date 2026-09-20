---
"@zhin.js/adapter-kook": patch
---

Require the canonical KOOK endpoint array and stop reading endpoint identity, credentials, webhook verification, encryption, or path values from `process.env`. Configure accounts under `plugins.kook.endpoints`, for example `[{ id: "main", token: "${KOOK_TOKEN}", connection: "websocket" }]`; each entry uses `id` as its identity and may override the plugin-level connection settings. The public config type is now `KookEndpointConfig`.
