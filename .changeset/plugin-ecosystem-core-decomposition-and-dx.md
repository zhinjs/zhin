---
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/process-monitor": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/host-http": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/testing": patch
"create-zhin-app": patch
---

Upgrade official business plugins with declarative Console pages & AI skills/tools, decompose core monolith modules, and polish scaffolding DX:

- **Official Plugin Ecosystem Upgrade**: Add declarative Console pages (`pages/index/index.ts`), `definePluginConsoleRpc` handlers (`src/console.ts`), and progressive-disclosure AI skills/tools (`skills/<name>/tools/`) across `@zhin.js/plugin-ledger`, `@zhin.js/plugin-reminder`, `@zhin.js/plugin-rss`, `@zhin.js/plugin-calendar`, `@zhin.js/plugin-group-suite`, `@zhin.js/plugin-content-moderation`, `@zhin.js/process-monitor`, and `@zhin.js/plugin-game-hub`.
- **Core Monolith Decomposition**: Decompose 9 core monolith modules (`agent-core-run.ts`, `full-agent-turn-engine.ts`, `ingress-route.ts`, `request.ts`, `root-runtime.ts`, `account-runtime.ts`, `page-renderer.ts`, `console-rpc.ts`, and `console-rest-pages.ts`) into cohesive, acyclic submodules (`< 620` lines each) while preserving 100% of public exports.
- **Scaffolding & First-Screen DX**: Upgrade `create-zhin-app` and `@zhin.js/scaffold-wizard` to generate declarative `ConsolePageBlueprint` homepages and `definePluginConsoleRpc` status/ping endpoints in both `zh-CN` and `en`; upgrade `zhin new` (`@zhin.js/cli`) to include `pages/` and compile progressive-disclosure tools under `skills/**/tools/` and `agents/**/tools/`.
