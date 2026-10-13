---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Separate Workroom runtime code from the generic Agent runtime (`src/workroom-runtime/`) and remove Agent-core reverse dependencies on Workroom.

Migration notes:
- `validateWorkroomDefinitions` is no longer exported from `@zhin.js/agent/config`; import it from `@zhin.js/agent`.
- Workroom console fields (`workroom`, `workroomCatalog`, `workroomControl`, `workroomProfiles`, `workroomKnowledge`, `portfolioSponsor`, `effectSponsor`, `dataLifecycle`) moved from `AgentHostConsolePort` to the new `workroomHostToken` (`@zhin.js/agent/runtime`).
- `defineAiDatabaseModels` now registers only Agent tables; call `defineWorkroomDatabaseModels` for Workroom tables. `activateAiDatabaseStorage` no longer activates the Workroom journal/catalog; use `prepareWorkroomDatabaseStorage` (validates persisted journal headers) before it and `.activate(...)` after.
