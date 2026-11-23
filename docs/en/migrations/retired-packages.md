---
title: 'Upgrading: Merged and Retired Packages'
description: '@zhin.js packages that were merged into another package, renamed or removed, and deleted subpaths, their replacement imports and what to do; how zhin doctor and zhin migrate flag them'
---

# Upgrading: Merged and Retired Packages

The `@zhin.js` packages below were merged into another package, renamed or removed and get no new releases. Their last releases on the registry still depend on old Zhin packages (for example `@zhin.js/config-yaml@1.1.0` pulls in `@zhin.js/runtime@1.1.0` and `@zhin.js/plugin-runtime@1.1.9`): as long as the project depends on one directly, `node_modules` holds a second copy of a Zhin package and the single-instance check reports it. Pinning the version with `pnpm.overrides` only hides the problem: rewrite the imports and remove the dependency.

| Package | Status | Replacement import or package | What to do |
| --- | --- | --- | --- |
| `@zhin.js/adapter-process` | renamed `@zhin.js/adapter-sandbox` | `@zhin.js/adapter-sandbox` | depend on it, adjust the plugin configuration per its docs, remove the old dependency |
| `@zhin.js/ai-provider` | merged into `@zhin.js/ai` | `@zhin.js/ai/provider` | rewrite imports, remove the dependency |
| `@zhin.js/config-file` | merged into `@zhin.js/runtime` | `@zhin.js/runtime` (or `@zhin.js/runtime/config-file`): `YamlConfigDocument`, `JsonConfigDocument`, `createConfigDocument` | rewrite imports, remove the dependency |
| `@zhin.js/config-yaml` | retired, merged into `@zhin.js/runtime` | `import { YamlConfigDocument } from '@zhin.js/runtime'`; `YamlConfigDocumentError` is renamed `ConfigFileDocumentError`, and `ConfigDocumentParseError` and `ConfigDocumentConflictError` now extend `ConfigFileDocumentError` (`ConfigDocumentParseError` takes an extra `format` argument) | rewrite imports and `instanceof` checks, remove the dependency |
| `@zhin.js/console` | removed (renamed `@zhin.js/host-api` first, which is removed too) | none: `zhin start` assembles the Console and HTTP Host | remove the dependency and its plugin configuration |
| `@zhin.js/console-app` | removed (the Console front end left this repository) | none: `zhin start` assembles the Console | remove the dependency |
| `@zhin.js/console-core` | renamed `@zhin.js/pagemanager` | `@zhin.js/pagemanager`; the browser half (`loadConsoleEntries`, `apiFetch`, …) is in `@zhin.js/client` | switch the dependency, remove the old one |
| `@zhin.js/console-types` | merged into `@zhin.js/contract` | `@zhin.js/contract` (check the names against its current exports) | rewrite imports, remove the dependency |
| `@zhin.js/dependency` | retired | no direct replacement | remove the dependency once nothing uses it |
| `@zhin.js/devteam` | retired | no direct replacement | remove the dependency once nothing uses it |
| `@zhin.js/game-shared` | renamed `@zhin.js/game-kit` | `@zhin.js/game-kit` (rewrite against its current exports) | rewrite imports, remove the dependency |
| `@zhin.js/hmr` | retired | no direct replacement | remove the dependency once nothing uses it |
| `@zhin.js/host-api` | removed | none: `zhin start` assembles the Console and HTTP Host | remove the dependency and its plugin configuration |
| `@zhin.js/host-router` | removed | none: `@zhin.js/host-http`, assembled by `zhin start`, serves HTTP | remove the dependency and its plugin configuration |
| `@zhin.js/http` | removed (renamed `@zhin.js/host-router` first, which is removed too) | none: `@zhin.js/host-http`, assembled by `zhin start`, serves HTTP | remove the dependency and its plugin configuration |
| `@zhin.js/http-host` | removed (split into `@zhin.js/host-router` and `@zhin.js/host-api`, both removed too) | none: `@zhin.js/host-http`, assembled by `zhin start`, serves HTTP | remove the dependency |
| `@zhin.js/interaction` | merged into `@zhin.js/im-contract` | `@zhin.js/im-contract/interaction` | rewrite imports, remove the dependency |
| `@zhin.js/isolate` | merged into `@zhin.js/runtime` | `@zhin.js/runtime/isolate` | rewrite imports, remove the dependency |
| `@zhin.js/plugin-github-notify` | became the GitHub adapter | `@zhin.js/adapter-github` (webhook notifications are part of it) | depend on it, configure it per its docs, remove the old dependency |
| `@zhin.js/plugin-html-renderer` | removed | `@zhin.js/html-renderer` | switch the dependency, remove the old one and its plugin configuration |
| `@zhin.js/plugin-test-kit` | renamed `@zhin.js/testing` | `@zhin.js/testing` (same API, same `PluginTestKit`) | rewrite imports, remove the dependency |
| `@zhin.js/plugin-voice` | removed | `@zhin.js/speech`; the config key `voice:` becomes `speech:` | switch the dependency and configuration, remove the old dependency |
| `@zhin.js/queue-runtime` | retired | no direct replacement | remove the dependency once nothing uses it |
| `@zhin.js/satori` | removed | raster rendering now comes from `@zhin.js/html-renderer` | switch to it, remove the dependency |
| `@zhin.js/sensitive-filter` | removed | `@zhin.js/plugin-content-moderation` | depend on and configure it, remove the old dependency and its plugin configuration |
| `@zhin.js/storage-port` | retired | no direct replacement | remove the dependency once nothing uses it |
| `@zhin.js/types` | retired | no direct replacement | remove the dependency once nothing uses it |
| `@zhin.js/workroom` | removed | none: declare groups or channels shared by several bots in `ai.venues`, and the collaboration scope in `collaboration` of `agents/<name>/agent.json` | remove the dependency |

"No direct replacement" means the repository history names no package that took over: those entries only tell you to remove the dependency and suggest no replacement path.

## Deleted subpaths

The package itself is still published, but the subpath exports below were deleted, so importing them fails at install or run time:

| Subpath | Use instead | Notes |
| --- | --- | --- |
| `@zhin.js/agent/tools` | `@zhin.js/tool` | import `defineAgentTool` from `@zhin.js/tool` and put tools in `tools/<name>/index.ts`; `toolApprovalAlways` / `toolApprovalOnce` / `toolApprovalNever` become `requiresApproval` of `defineAgentTool`, set to `'always'`, `'once'` or `'never'` |

## How the tools flag them

- The retired-packages check of `zhin doctor` reads the `package.json` of the root and of every pnpm workspace member (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`); each warning names the file, the replacement and the dependency to remove. An import of a deleted subpath above in the project's sources (or of a retired package no manifest declares) is a warning too, listing file and line for the first five.
- When the single-instance check reports duplicates, it first follows the chain to the direct dependency that drags the old release in (also when a workspace member depends on that old release directly); when that dependency is in the table above, the table's fix comes first, once per retired package however many old releases it drags in, and `pnpm.overrides` is only the last suggestion.
- `zhin migrate` does not upgrade the packages above, and its retired-packages step lists the `package.json` that declares each one and the imports to rewrite in the project's sources (file and line, deleted subpaths included; specifiers inside comments and other strings do not count). Where a retired package exported only its root, an import with a subpath (such as `@zhin.js/isolate/x`) gets the action but no replacement path. It neither rewrites sources nor removes dependencies: a retired package may export more than its replacement took over, so you confirm and edit by hand.

## Example

```ts
// before
import { YamlConfigDocument } from '@zhin.js/config-yaml';
// after
import { YamlConfigDocument } from '@zhin.js/runtime';
```

```bash
pnpm remove @zhin.js/config-yaml
# after removing the pnpm.overrides added for it
pnpm install
zhin doctor   # the single-instance check should pass
```

See also [CLI: doctor](../cli/index.md#doctor-environment-diagnostics) and [CLI: migrate](../cli/index.md#migrate).
