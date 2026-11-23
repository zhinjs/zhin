---
"@zhin.js/cli": patch
"@zhin.js/gateway": patch
---

#1250 第 97 批：已并入或停更的 `@zhin.js` 包（retired-package-not-flagged）与 `zhin migrate` 的 pnpm 设置。

- `@zhin.js/gateway/project` 新增已并入或停更的 `@zhin.js` 包清单与查询：`RETIRED_ZHIN_PACKAGES`、`findRetiredZhinPackage(name)`、`findRetiredDependencies(manifest)`、`findRetiredImports(source)`，类型 `RetiredZhinPackage`、`RetiredPackageImport`、`RetiredDependency`、`RetiredImportUse`。清单含 `@zhin.js/config-yaml`（改用 `@zhin.js/runtime` 的 `YamlConfigDocument`）、`@zhin.js/config-file`、`@zhin.js/isolate`（并入 `@zhin.js/runtime`）、`@zhin.js/interaction`（并入 `@zhin.js/im-contract/interaction`）、`@zhin.js/ai-provider`（并入 `@zhin.js/ai/provider`）、`@zhin.js/tools`（改用 `@zhin.js/tool`）以及已删除的 `@zhin.js/host-router`、`@zhin.js/host-api`、`@zhin.js/workroom`，每条写明替代 import 与操作；文档新增「升级：已并入或停更的包」。
- `zhin doctor` 新增「已停更的 Zhin 包」：根目录或 pnpm 工作区成员的 `package.json` 直接依赖清单中的包时给出警告，写明改用什么、删除这个依赖。
- 「Zhin 包单实例」报重复时，先沿依赖链指出是根项目或工作区成员的哪个直接依赖拖进了旧版本（如 `@zhin.js/config-yaml@1.1.0 → @zhin.js/runtime@1.1.0 → @zhin.js/plugin-runtime@1.1.9`），该依赖已停更时直接给出替代改法，`pnpm.overrides` 只作为最后一条建议。
- `zhin migrate` 不再升级清单中的包，新增「已停更的 Zhin 包」一步，列出声明它们的 `package.json` 与项目源码中要改写的 import（文件与行号）；不自动改写源码、不删除依赖。
- （行为变化）`zhin migrate`（含 `--include-pinned`）只在冷却期生效时才写 `minimumReleaseAgeExclude`：项目在 `pnpm-workspace.yaml`、项目 `.npmrc`（`minimum-release-age`）或 `package.json#pnpm` 把 `minimumReleaseAge` 设为大于 0，或未设置但项目用 pnpm 11+；否则不写并打印原因。`zhin doctor` / migrate 解释版本未装上的原因时同样读取这三处。
- （行为变化）已列在 `onlyBuiltDependencies` 的网关原生依赖（如 `node-pty`）在 pnpm 10 及更早版本下不再另写 `allowBuilds`；确认 pnpm 11 时仍写（pnpm 11 只读 `allowBuilds`）。
