---
"@zhin.js/adapter": patch
---

Prevent deferred connections from starting after stop, keep an older startup from marking a replacement connection open, and immediately close resources registered by the current connection after it has been stopped.

Apply the same generation guard to automatic reconnect completion and failure so an obsolete reconnect cannot change the state of a replacement startup.
