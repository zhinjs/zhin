---
'@zhin.js/adapter-email': patch
---

Ignore late disconnect events from replaced IMAP transports so reconnect does not leak duplicate connections.
