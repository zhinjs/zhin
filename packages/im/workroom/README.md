# @zhin.js/workroom

Workroom, Portfolio and Data Governance domain code for Zhin.js, extracted from `@zhin.js/agent`.

- `src/workroom/` - Workroom kernel, journals, assignments, ingress, executors
- `src/portfolio/` - Portfolio admission, capacity control, sponsor projection
- `src/data-governance/` - payload vaults, disclosure manifests, governance authority

## Dependency direction

`@zhin.js/agent` -> `@zhin.js/workroom` -> `@zhin.js/im-contract`

This package may only depend on `@zhin.js/im-contract` and Node built-ins. It must never import
`@zhin.js/agent`, `@zhin.js/core` or lower framework layers. Inside it, `data-governance/` must not
import `workroom/` or `portfolio/`.

## Temporary subpath exports

The `./workroom/*.js`, `./portfolio/*.js` and `./data-governance/*.js` deep subpaths exist only so
`@zhin.js/agent` can keep one-line compatibility re-exports at its old internal paths during A4a.
They are removed or narrowed after A4b/A5, together with those compatibility stubs. Use the package root (`@zhin.js/workroom`).
