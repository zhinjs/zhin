---
"@zhin.js/adapter-qq": patch
---

Use the shared Endpoint lifecycle for QQ WebSocket and HTTP receivers. Isolate each SDK instance and its Webhook routes, close resources created by late startup completion after cancellation, and ignore callbacks queued by replaced SDK instances. Failed startup releases resources before retrying.
