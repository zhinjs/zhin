---
"@zhin.js/agent": patch
"@zhin.js/workroom": patch
"@zhin.js/cli": patch
"@zhin.js/a2a": patch
---

Move the Workroom runtime composition (`workroom-runtime`) from `@zhin.js/agent` into `@zhin.js/workroom`; the dependency direction is now `@zhin.js/workroom` -> `@zhin.js/agent`.

- Workroom exports were removed from `@zhin.js/agent`, `@zhin.js/agent/runtime` and `zhin.js/agent`; import them from `@zhin.js/workroom` (the export names are unchanged). `@zhin.js/agent` no longer depends on `@zhin.js/workroom`.
- The `Local*` assignment authority types declared by the authority provider module (`WorkroomLocalAssignmentAuthorityInput`, `WorkroomLocalAssignmentResolvedAuthority`, `WorkroomLocalAssignmentAuthorityPort`) clash with the domain contracts of the same name in a single barrel; the provider variants are exported with a `WorkroomProvider` prefix.
- Compatibility stubs at the old internal agent paths and the `./workroom/*.js`, `./portfolio/*.js`, `./data-governance/*.js` deep exports of `@zhin.js/workroom` are removed. Use the package root.
- `@zhin.js/agent` gains three narrow host-integration exports: `collectAgentLoopTurnRun` and type `ZhinAgentPrivate` (`@zhin.js/agent/core`), and `runWithAgentTurnConfiguration` (`@zhin.js/agent/turn`).
- `@zhin.js/cli` and `@zhin.js/a2a` now depend on `@zhin.js/workroom`.
