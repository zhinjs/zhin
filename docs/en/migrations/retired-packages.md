---
title: 'Upgrading: Merged and Retired Packages'
description: '@zhin.js packages that were merged into another package or removed, their replacement imports and what to do; how zhin doctor and zhin migrate flag them'
---

# Upgrading: Merged and Retired Packages

The `@zhin.js` packages below were merged into another package or removed and get no new releases. Their last releases on the registry still depend on old Zhin packages (for example `@zhin.js/config-yaml@1.1.0` pulls in `@zhin.js/runtime@1.1.0` and `@zhin.js/plugin-runtime@1.1.9`): as long as the project depends on one directly, `node_modules` holds a second copy of a Zhin package and the single-instance check reports it. Pinning the version with `pnpm.overrides` only hides the problem: rewrite the imports and remove the dependency.

| Package | Status | Replacement import | What to do |
| --- | --- | --- | --- |
| `@zhin.js/ai-provider` | merged into `@zhin.js/ai` | `@zhin.js/ai/provider` | rewrite imports, remove the dependency |
| `@zhin.js/config-file` | merged into `@zhin.js/runtime` | `@zhin.js/runtime` (or `@zhin.js/runtime/config-file`): `YamlConfigDocument`, `JsonConfigDocument`, `createConfigDocument` | rewrite imports, remove the dependency |
| `@zhin.js/config-yaml` | retired, merged into `@zhin.js/runtime` | `import { YamlConfigDocument } from '@zhin.js/runtime'` | rewrite imports, remove the dependency |
| `@zhin.js/host-api` | removed | none: `zhin start` assembles the Console and HTTP Host | remove the dependency and its plugin configuration |
| `@zhin.js/host-router` | removed | none: `@zhin.js/host-http`, assembled by `zhin start`, serves HTTP | remove the dependency and its plugin configuration |
| `@zhin.js/interaction` | merged into `@zhin.js/im-contract` | `@zhin.js/im-contract/interaction` | rewrite imports, remove the dependency |
| `@zhin.js/isolate` | merged into `@zhin.js/runtime` | `@zhin.js/runtime/isolate` | rewrite imports, remove the dependency |
| `@zhin.js/tools` | removed | `@zhin.js/tool` (`defineAgentTool`, `tools/<name>/index.ts`) | rewrite the tool definitions, remove the dependency |
| `@zhin.js/workroom` | removed | none: declare groups or channels shared by several bots in `ai.venues`, and the collaboration scope in `collaboration` of `agents/<name>/agent.json` | remove the dependency |

## How the tools flag them

- The retired-packages check of `zhin doctor` reads the `package.json` of the root and of every pnpm workspace member (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`); each warning names the file, the replacement and the dependency to remove.
- When the single-instance check reports duplicates, it first follows the chain to the direct dependency that drags the old release in; when that dependency is in the table above, the table's fix comes first, and `pnpm.overrides` is only the last suggestion.
- `zhin migrate` does not upgrade the packages above, and its retired-packages step lists the `package.json` that declares each one and the imports to rewrite in the project's sources (file and line). It neither rewrites sources nor removes dependencies: a retired package may export more than its replacement took over, so you confirm and edit by hand.

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
