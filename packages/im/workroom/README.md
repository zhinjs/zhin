# @zhin.js/workroom

Workroom, Portfolio and Data Governance for Zhin.js: the domain code plus the runtime composition that wires it to the Agent runtime.

- `src/workroom/` - Workroom kernel, journals, assignments, ingress, executors
- `src/portfolio/` - Portfolio admission, capacity control, sponsor projection
- `src/data-governance/` - payload vaults, disclosure manifests, governance authority
- `src/workroom-runtime/` - runtime composition (Plugin Runtime tokens, Agent Core adapter, providers)

## Dependency direction

`@zhin.js/workroom` -> `@zhin.js/agent` (+ `@zhin.js/plugin-runtime`, `@zhin.js/tool`, `@zhin.js/skill`, `@zhin.js/ai`, `@zhin.js/core`) -> `@zhin.js/im-contract`

`@zhin.js/agent` must never import `@zhin.js/workroom`. The domain directories (`workroom/`,
`portfolio/`, `data-governance/`) stay free of framework imports (only `@zhin.js/im-contract` and
Node built-ins); only `workroom-runtime/` may use `@zhin.js/agent`. Inside the package,
`data-governance/` must not import `workroom/` or `portfolio/`.

Import everything from the package root (`@zhin.js/workroom`).
