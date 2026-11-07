---
"@zhin.js/cli": patch
"@zhin.js/client": patch
"@zhin.js/pagemanager": patch
"@zhin.js/console-contract": patch
"@zhin.js/host-http": patch
"@zhin.js/mcp": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/core": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/runtime": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/process-monitor": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/plugin-answers": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-rss": patch
---

fix: post-refactor audit fixes across runtime, console blueprints, AI setup, and plugin stores

- **Agent & Runtime**: adapt `DatabaseHost` models for `DatabaseEngagementJournal` after `DatabaseHost.start()` (`this[#db].select is not a function`), suppress deferred database warning in `seedInitialAiPlanIfEmpty`, lazy-load `@zhin.js/agent/runtime` in `agent-console.ts`, wrap `#receiveSideEvent` with `withEndpointEventPayload` and `captureInteraction`, select only `('id', 'timestamp')` in `SystemLogDatabaseTransport.prune()`, and surface clear install errors when optional AI/protocol packages are absent.
- **Console Blueprints & RPC**: bundle `.ts` blueprint page entries via `esbuild` in `TypeScriptClientBuilder` so `spec`, `fields`, `dictionary`, `pollMs`, and `reviewSpec` are preserved in browser bundles; wire `CommentReviewSession` in `DeclarativePageView`; authorize `zhin.game` / `zhin.feature.game` in `plugin-console-rpc.ts`; forward `locale` in `entry-routes.ts`; pass `pluginId: entry.owner ?? entry.id` in `loadConsoleEntries.ts`.
- **Plugin Store & Capabilities**: make `deriveStoreDisposer` idempotent in `@zhin.js/plugin-runtime`, guard nullish `carrier.resources`, handle `{ dispose }` return shapes in isolate `bootstrap.ts`, remove duplicate manual disposals in `answers`/`earthquake`, guard optional `projectLocaleToken` in `calendar`/`reminder`/`rss`/`lottery`, migrate `process-monitor` to `definePluginStore`, and align `capabilityGraph` declarations across plugins.
