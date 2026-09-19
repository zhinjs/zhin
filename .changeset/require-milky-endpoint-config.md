---
"@zhin.js/adapter-milky": minor
---

Require one canonical expanded Milky endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity from `process.env`, and reverse WebSocket connection replacement, heartbeat, and cleanup now use the shared endpoint lifecycle.
