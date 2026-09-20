---
'@zhin.js/feature-kit': minor
'@zhin.js/command': minor
'@zhin.js/adapter': minor
'@zhin.js/middleware': minor
'@zhin.js/handler': minor
'@zhin.js/component': minor
'@zhin.js/tool': minor
'@zhin.js/mcp-feature': minor
'@zhin.js/schedule-feature': minor
'@zhin.js/prompt-section': minor
'@zhin.js/page': minor
'@zhin.js/runtime': minor
'@zhin.js/agent': minor
'@zhin.js/cli': minor
'create-zhin-app': minor
'zhin.js': minor
'@zhin.js/adapter-dingtalk': patch
'@zhin.js/adapter-discord': patch
'@zhin.js/adapter-email': patch
'@zhin.js/adapter-github': patch
'@zhin.js/adapter-icqq': patch
'@zhin.js/adapter-kook': patch
'@zhin.js/adapter-lark': patch
'@zhin.js/adapter-line': patch
'@zhin.js/adapter-milky': patch
'@zhin.js/adapter-napcat': patch
'@zhin.js/adapter-onebot11': patch
'@zhin.js/adapter-onebot12': patch
'@zhin.js/adapter-qq': patch
'@zhin.js/adapter-sandbox': patch
'@zhin.js/adapter-satori': patch
'@zhin.js/adapter-slack': patch
'@zhin.js/adapter-telegram': patch
'@zhin.js/adapter-wechat-mp': patch
'@zhin.js/adapter-wecom': patch
'@zhin.js/adapter-weixin-ilink': patch
'@zhin.js/plugin-60s': patch
'@zhin.js/plugin-blackjack': patch
'@zhin.js/plugin-code-runner': patch
'@zhin.js/plugin-content-moderation': patch
'@zhin.js/plugin-dice-duel': patch
'@zhin.js/plugin-dungeon-expedition': patch
'@zhin.js/plugin-game-hub': patch
'@zhin.js/plugin-group-suite': patch
'@zhin.js/plugin-guess-number': patch
'@zhin.js/plugin-idiom-chain': patch
'@zhin.js/plugin-link-poster': patch
'@zhin.js/plugin-lottery': patch
'@zhin.js/plugin-music': patch
'@zhin.js/plugin-qrcode': patch
'@zhin.js/plugin-repeater': patch
'@zhin.js/plugin-rps': patch
'@zhin.js/plugin-rss': patch
'@zhin.js/plugin-short-url': patch
'@zhin.js/plugin-text-adventure': patch
'@zhin.js/plugin-tic-tac-toe': patch
'@zhin.js/plugin-word-riddle': patch
'@zhin.js/process-monitor': patch
---

Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.
