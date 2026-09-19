---
"@zhin.js/host-http": patch
---

Scope the Console marketplace registry cache to each Host route registration so Hosts with different registries cannot reuse one another's plugin data. Concurrent registry reads within one Host now share the same in-flight request.
