---
'@zhin.js/runtime': patch
'@zhin.js/plugin-runtime': patch
'@zhin.js/config-file': patch
'@zhin.js/cli': patch
---

Replace the YAML-only configuration adapter with the format-neutral `@zhin.js/config-file` module. YAML and JSON Root configurations now share one transactional file lifecycle with revision checks, atomic commit, rollback, and generation handoff; JSON is no longer loaded as a non-transactional startup snapshot. Configuration document ports and canonical immutable patch semantics now live in the foundational Plugin Runtime contract, so persistence adapters do not depend on schema composition and generation implementations.
