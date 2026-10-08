---
"@zhin.js/adapter-line": patch
---

Deduplicate concurrent and completed LINE webhook event IDs within the endpoint instance, retaining successful admission for 24 hours with a bounded cache. Failed admission remains retryable; stop clears the cache. Document that this does not provide persistent or exactly-once business processing.
