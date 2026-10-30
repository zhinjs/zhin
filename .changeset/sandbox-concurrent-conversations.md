---
'@zhin.js/adapter-sandbox': minor
---

Support concurrent Console connections with per-conversation subscriptions and negotiated input echoes. Preserve Bot identities, legacy clients and server-side approvals; isolate other conversations and demo connections, and leave delivery unconfirmed when no subscriber accepts a reply.

Reuse Console conversation, usage and request readers within the active workspace when available, with a standalone-page fallback for older shells. Isolate trace reads and cancellation feedback across scene and connection changes without repeating cancellation requests.
