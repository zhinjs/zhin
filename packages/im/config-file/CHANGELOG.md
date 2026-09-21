# @zhin.js/config-file

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11

## 1.1.1

### Patch Changes

- 3d42fc9: Replace the YAML-only configuration adapter with the format-neutral `@zhin.js/config-file` module. YAML and JSON Root configurations now share one transactional file lifecycle with revision checks, atomic commit, rollback, and generation handoff; JSON is no longer loaded as a non-transactional startup snapshot. Configuration document ports and canonical immutable patch semantics now live in the foundational Plugin Runtime contract, so persistence adapters do not depend on schema composition and generation implementations.
- 2dbbc15: Classify watched Root configuration changes by their actual Host and Plugin projections, reload only affected Plugin subtrees, and request a process restart for Host configuration changes. Reload project dotenv layers as Runtime inputs so environment references are re-expanded without mutating global process state.
- 507d602: Make the Root `ConfigFileDocument` the sole configuration authority for Runtime, Endpoint commands, and Console. Console source editing now preserves the active YAML or JSON format, uses optimistic revision checks, returns one consistent source-and-key snapshot, and exposes canonical `config:get-source` / `config:replace-source` RPCs without the former YAML-only compatibility names.
- df9f76b: Make Endpoint configuration persistence asynchronous and route it through the canonical transactional Root configuration port. Endpoint management now supports both YAML and JSON, materializes a missing Root config safely, serializes concurrent mutations, restores `.env` when the config commit fails, and restarts the development process after environment-file changes.
- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [3d42fc9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
