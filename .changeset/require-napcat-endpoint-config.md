---
"@zhin.js/adapter-napcat": patch
---

Require one canonical expanded NapCat endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity from `process.env`, and reverse WebSocket connection heartbeat/cleanup now uses the shared endpoint lifecycle.
