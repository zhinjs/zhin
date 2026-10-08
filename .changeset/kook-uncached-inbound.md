---
"@zhin.js/adapter-kook": patch
---

Preserve inbound message identity and routing when kook-client user or channel cache enrichment getters throw. Missing cached display names and roles no longer discard incoming messages.

Allow message transport startup when optional blacklist cache preloading is explicitly denied with HTTP 403. Explicit blacklist management requests and other startup failures still propagate.
