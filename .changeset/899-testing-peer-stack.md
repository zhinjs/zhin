---
"@zhin.js/testing": patch
---

Stop installing a second Zhin stack next to the plugin's own `zhin.js` (#899). `@zhin.js/testing` no longer pins exact versions of `@zhin.js/core`, `@zhin.js/runtime`, `@zhin.js/plugin-runtime`, `@zhin.js/adapter` and the other `@zhin.js/*` packages. It resolves them through the plugin's `zhin.js` (`zhin.js`, `zhin.js/plugin-runtime`, `zhin.js/core/runtime`, `zhin.js/command`, …) and declares `zhin.js`, `@zhin.js/runtime` and `@zhin.js/tool` as peer dependencies. A standalone plugin with both `zhin.js` and `@zhin.js/testing` now installs every `@zhin.js/*` package once with pnpm and npm, so the Runtime no longer fails with `Multiple package locations … are not supported in one generation`, and tests run on the same stack as a real bot. `@zhin.js/command` is no longer a separate peer; it comes from `zhin.js`.

Migration: pnpm and npm (7+) install the peers automatically, so nothing changes there. With a package manager that does not install peers (yarn 1, or pnpm with `auto-install-peers=false`), add them yourself: `yarn add -D zhin.js @zhin.js/runtime @zhin.js/tool @zhin.js/testing`. Upgrade `@zhin.js/testing` together with `zhin.js`: the kit requires a `zhin.js` at least as new as the one released with it, and with an older one npm stops with `ERESOLVE` while pnpm reports an unmet peer.
