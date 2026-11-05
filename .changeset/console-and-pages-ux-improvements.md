---
"@zhin.js/pagemanager": patch
"@zhin.js/page": patch
"@zhin.js/contract": patch
"@zhin.js/client": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/cli": patch
"@zhin.js/adapter-sandbox": patch
---

Upgrade Console Host, Plugin Pages compiler/DX, and `/sandbox` workbench:

- Populate React 19, `react-dom/client`, and `react-router-dom` named exports and standalone ESM fallback in `@zhin.js/pagemanager`.
- Re-export `definePage` from `@zhin.js/page`, forward all `PageMetadata` fields (`group`, `order`, `parent`, `fullWidth`, `titleI18n`), and inject `{ pluginId, owner, localName, route, title }` props into page components.
- Add `definePluginConsoleRpc.withConfig<TConfig>()` and `@zhin.js/client` `createDeclarativePage` helper.
- Upgrade local Console shell (`page-renderer.ts`), live `log:entry` SSE broadcasts, and `/sandbox` simulated sender identity/role switching and rich segment rendering.
