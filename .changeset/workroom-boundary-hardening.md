---
"@zhin.js/workroom": patch
"@zhin.js/cli": patch
---

Harden the `@zhin.js/agent` -> `@zhin.js/workroom` boundary and tidy Workroom packaging (no runtime behavior change).

- The architecture check now delegates the agent -> workroom source and manifest rules to pure functions (`scripts/lib/agent-workroom-boundary.mjs`) with unit tests covering bare/sub-path specifiers, barrels, type-only and dynamic imports, relative paths into Workroom directories, and all four manifest dependency sections.
- CLI Workroom tests use the public `module.js` entry where it is reachable; the remaining internal-coordinator tests are kept (with a documented reason each) and guarded by an allowlist in `module-boundary.test.ts`. The a2a path now has tests for "package missing -> install hint with `cause`" and "other errors rethrown unchanged".
- `@zhin.js/workroom` keeps `@zhin.js/agent` and `@zhin.js/plugin-runtime` as regular dependencies (single workspace instance; a peer-dependency move needs a lockfile update to be evaluated with the CLI peer graph).
- The `@zhin.js/workroom` deep-path exports were fully removed in A4b; only the package root is exported.
