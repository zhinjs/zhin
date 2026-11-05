---
'@zhin.js/cli': patch
'@zhin.js/database': patch
'@zhin.js/schema': patch
'@zhin.js/pagemanager': patch
'@zhin.js/client': patch
'@zhin.js/agent': patch
'@zhin.js/command': patch
'@zhin.js/component': patch
'@zhin.js/core': patch
'@zhin.js/feature-kit': patch
'@zhin.js/handler': patch
'@zhin.js/mcp-feature': patch
'@zhin.js/middleware': patch
'@zhin.js/runtime': patch
'@zhin.js/schedule-feature': patch
'@zhin.js/tool': patch
'create-zhin-app': patch
'@zhin.js/scaffold-wizard': patch
'@zhin.js/testing': patch
---

Improve plugin authoring DX, operator/CLI onboarding, IM/AI chat UX, CI reliability, and documentation narrative across the workspace:

- **Plugin Authoring DX**:
  - Compare `mtimeMs` between `src/*.ts` and compiled `lib/*.js` in native TypeScript development runtime so stale `lib/` build outputs never shadow newer source edits.
  - Support `@zhin.js/schema` `Schema.object()` directly in `defineAgentTool` (`inputSchema`) with full TypeScript type inference and default value population.
  - Allow equivalent `definePlugin({ config })` and `schema.json` to coexist without throwing `PluginConfigSourceConflictError`.
  - Add `.withConfig<TConfig>()` helpers to `defineMiddleware`, `defineHandler`, `defineComponent`, `defineSchedule`, and `defineMcp`, and expose `has(token)` on `CapabilityContext`.
  - Enhance `@zhin.js/testing` with `createFakeInteraction`, automatic positional/option default parsing in `runCommand`, and `$sendTo` / `$replyTo*` helpers on `FakeMessage`.
- **CLI, Wizard & Local Sandbox UX**:
  - Automatically seed `ai.plan.yml` into the Host database on first startup when the inference graph is empty.
  - Add domestic and aggregator AI provider presets (`qwen` / DashScope, `siliconflow`, `volcengine`, `minimax`, `openrouter`) and automatic capability pre-filling in `@zhin.js/scaffold-wizard`.
  - Add `/sandbox?token=...` query bootstrap and header token input UI for zero-DevTools local sandbox debugging, plus `zhin start` alias and unset `${ENV_VAR}` config warnings.
- **IM Command, Interactive Fallback & AI Chat UX**:
  - Reset per-conversation fallback button numbering once previous interactive prompts finish and ignore TTL-expired bare numeric messages in group chats.
  - Deduplicate numbered option lists in text-fallback `user-interaction` prompts.
  - Support out-of-the-box `菜单` / `帮助` / `help` / `menu` aliases, flattened root command menus (when ≤ 8 commands), `-h` help flag, distinct missing-parameter diagnostics, and `@Bot /cmd` mention stripping in group chats.
  - Preserve `<header>` / `<footer>` in HTML text fallback, format Markdown tables cleanly in plain-text fallback, bind tool approval prompts to master senders, and lower turn progress feedback interval to 15s.
