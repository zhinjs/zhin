---
'@zhin.js/adapter-sandbox': patch
---

Support concurrent Console connections with per-conversation subscriptions and negotiated input echoes. Preserve Bot identities, legacy clients and server-side approvals; isolate other conversations and demo connections, and leave delivery unconfirmed when no subscriber accepts a reply.

Reuse Console conversation, usage and request readers within the active workspace when available, with a standalone-page fallback for older shells. Isolate trace reads and cancellation feedback across scene and connection changes without repeating cancellation requests.

Recover Host-scoped conversation metadata, canonical chat history, read-only offline results and current live interactions without migrating browser caches or replaying execution. Keep historical controls read-only and use the existing server authority for live answers.
