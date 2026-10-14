---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Separate Workroom runtime code from the generic Agent runtime (`src/workroom-runtime/`) and remove Agent-core reverse dependencies on Workroom.

Migration notes:
- `validateWorkroomDefinitions` is no longer exported from `@zhin.js/agent/config`; import it from `@zhin.js/agent`.
- Workroom console fields (`workroom`, `workroomCatalog`, `workroomControl`, `workroomProfiles`, `workroomKnowledge`, `portfolioSponsor`, `effectSponsor`, `dataLifecycle`) moved from `AgentHostConsolePort` to the new `workroomHostToken` (`@zhin.js/agent/runtime`).
- `defineAiDatabaseModels` now registers only Agent tables; call `defineWorkroomDatabaseModels` for Workroom tables. `activateAiDatabaseStorage` no longer activates the Workroom journal/catalog; use `prepareWorkroomDatabaseStorage` (validates persisted journal headers) before it and `.activate(...)` after.
- `plugin-runtime/deferred-capability-plan.ts` is now Workroom-free: the Workroom realization/authority code moved to `workroom-runtime/workroom-capability-realization.ts` (same exports from `@zhin.js/agent/runtime`); `createDeferredCapabilityPlan` takes an injected `ceiling` (`DeferredCapabilityCeiling`) instead of `authority`, and `isReservedControlToolName` is exported.
- `createDeferredCapabilityPlan` now throws if the legacy `authority` option is passed (it used to be silently ignored; use `createWorkroomDeferredCapabilityPlan`), and it throws if the injected `ceiling` returns tools or skills that are not a subset of its input (by reference).
- `RESERVED_CONTROL_TOOL_PREFIX` ('workroom_') is also exported from `@zhin.js/agent/runtime` next to `isReservedControlToolName`.
