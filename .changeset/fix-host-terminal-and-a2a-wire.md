---
"@zhin.js/host-http": patch
"@zhin.js/a2a": patch
---

Make HTTP Host close terminal, share concurrent listen operations, and wait for a pending bind before closing to prevent late orphan listeners. Preserve canonical A2A v1 JSON message content, task/card/SSE serialization and standard REST-relative paths while retaining the existing /v1 aliases.
