---
'@zhin.js/handler': patch
'@zhin.js/feature-kit': patch
'@zhin.js/core': patch
'zhin.js': patch
'@zhin.js/cli': patch
---

Extract the `handlers/` convention into a dedicated Feature package `@zhin.js/handler`, and mount it as a platform Stable Feature on `@zhin.js/core` (inherited by Roots via `platformFeatures` / `zhin runtime start`).

Also add the `zhin.js/middleware` facade re-export so Stable Feature authoring is consistent with `zhin.js/command` / `adapter` / `component` / `handler`.

`@zhin.js/feature-kit` is now kit-only: handler authoring, `HandlerIndex`, and the Feature provider entry are removed. Do not list `@zhin.js/feature-kit` in `zhin.features`.

**Authoring:** apps and plugins that depend on `zhin.js` should import `define*` from facade subpaths (`zhin.js/command`, `zhin.js/middleware`, `zhin.js/handler`, `zhin.js/adapter`, `zhin.js/component`, `zhin.js/plugin-runtime`) — do not separately install the `@zhin.js/*` Feature implementation packages. Workspace plugins/examples were updated accordingly (redundant Feature deps removed; child plugins keep `zhin.features` mounts and peer `zhin.js`).

BREAKING CHANGE: `@zhin.js/feature-kit` no longer exports handler APIs and is no longer a `type: "feature"` package.
