# @zhin.js/handler

## 1.0.1

### Patch Changes

- d3920e9: Extract the `handlers/` convention into a dedicated Feature package `@zhin.js/handler`, and mount it as a platform Stable Feature on `@zhin.js/core` (inherited by Roots via `platformFeatures` / `zhin runtime start`).

  Also add the `zhin.js/middleware` facade re-export so Stable Feature authoring is consistent with `zhin.js/command` / `adapter` / `component` / `handler`.

  `@zhin.js/feature-kit` is now kit-only: handler authoring, `HandlerIndex`, and the Feature provider entry are removed. Do not list `@zhin.js/feature-kit` in `zhin.features`.

  **Authoring:** apps and plugins that depend on `zhin.js` should import `definePlugin` from the main entry (`zhin.js`) and other `define*` from facade subpaths (`zhin.js/command`, `zhin.js/middleware`, `zhin.js/handler`, `zhin.js/adapter`, `zhin.js/component`) — do not separately install `@zhin.js/plugin-runtime` or the `@zhin.js/*` Feature implementation packages. Workspace plugins/examples/adapters were updated accordingly (imports + deps; child plugins keep `zhin.features` mounts and peer `zhin.js`). CLI `zhin new` / migrate cutover scaffolds follow the same rule.

  BREAKING CHANGE: `@zhin.js/feature-kit` no longer exports handler APIs and is no longer a `type: "feature"` package.

- Updated dependencies [d3920e9]
  - @zhin.js/feature-kit@1.0.11
