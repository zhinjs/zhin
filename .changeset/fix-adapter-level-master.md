---
"@zhin.js/core": patch
"@zhin.js/runtime": patch
---

fix: resolve master/trusted identity from plugins.\<adapter\> config

Authorization previously only checked a top-level `endpoints[]` array for
master/trusted fields. When `master` was declared at the adapter level
(e.g. `plugins.icqq.master`), the sender was never recognized as master.

Two changes:

1. **authorization.ts** — `findEndpointEntryFromConfig` now also reads
   `plugins.<adapter>` and merges adapter-level `master`/`trusted` onto the
   matched endpoint entry so `resolveSenderRoles` sees them.

2. **config-composer.ts** — Adapter plugins (schemas with array-typed
   `endpoints`) automatically receive `master` and `trusted` schema
   properties when not already declared, so all adapters accept these
   framework-level fields without needing to manually add them to their
   own `schema.json`.
