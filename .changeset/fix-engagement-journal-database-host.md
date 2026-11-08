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
"@zhin.js/components": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
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
- **Architectural Enhancements**:
  1. **Model Capability Baseline Catalog + Override Layer** (`@zhin.js/ai`, `@zhin.js/scaffold-wizard`, `@zhin.js/cli`): add `MODEL_CAPABILITY_CATALOG`, `inferModelCapabilities`, and `applyModelCapabilityDefaults` so built-in models carry accurate `input`/`streaming`/`toolCalling`/`thinking` baselines while preserving explicit `provider.capabilities` overrides.
  2. **Zero-Bundler Declarative Blueprint Protocol** (`@zhin.js/console-contract`, `@zhin.js/client`, `@zhin.js/pagemanager`): add JSON-serializable `DeclarativeValueExpr` operators (`$path`, `$count`, `$sum`, `$format`, `$map`, `$join`, `$coalesce`) evaluated identically across Web, IM Card, and CLI Panel projections, plus in-process `ts.transpileModule` synthesis (`synthesizePureBlueprintModule`) in `TypeScriptClientBuilder`.
  3. **Auto CapabilityGraph Convention Merge & Codegen** (`@zhin.js/plugin-runtime`, `@zhin.js/runtime`, `@zhin.js/cli`): add `mergePluginCapabilityGraph`, `scanConventionCapabilityFeatures` (auto-merged during `PluginScopeAssembler.setupTree`), and `zhin runtime codegen [dir] --write --json`.
  4. **Durable Turn Step Checkpointing** (`@zhin.js/agent`): add `TurnCheckpointStore` and `DatabaseTurnCheckpointStorage` (`agent_turn_checkpoints`) so multi-step tool turns interrupted mid-flight record completed `(assistant[toolCall] -> toolResult[])` rounds and resume from the last committed `toolResult` boundary on retry or `"继续"`/`"continue"`.
- **UI Component System & Developer Preview Workbench** (`@zhin.js/client`, `@zhin.js/components`, `@zhin.js/cli`, `create-zhin-app`):
  - Expand `@zhin.js/client/ui` and `@zhin.js/components` with unified design tokens (`UI_DESIGN_TOKENS`), option icons (`RadioGroup`/`CheckboxGroup`), custom chart images/logos (`BarChart`/`Sparkline`/`DonutChart`/`GaugeBar`), batch table selection & sticky columns (`DataTable`), responsive viewport presets (`CardCanvas`), and shared layout/display primitives.
  - Add `zhin preview [dir]` command in `@zhin.js/cli` (and `"preview": "zhin preview"` in `create-zhin-app`) for zero-build live SSE component & page blueprint previewing, interactive `previewProps` JSON editing, canvas width/background presets, and box-model outline debugging.
- **IM Chat Controlled Restart & Post-Restart Channel Receipt** (`@zhin.js/cli`):
  - Add `installRestartHost` (`restart` / `重启` / `reboot` command for Bot owners) and `deliverPendingRestartReceipt` so owners can trigger a supervised process restart from any IM conversation and automatically receive the restart completion summary in the originating channel once the endpoint reconnects.
  - Ignore `SIGHUP` in `NativeTypeScriptSupervisor` when running in `--daemon` mode.
