---
"@zhin.js/adapter": patch
---

Add a compact adapter authoring form with framework-owned Endpoint identity, transactional connection cleanup, and lifecycle. Adapter `create()` may now return `{ client, connect, activate, send }`, while existing Endpoint subclasses remain compatible.
