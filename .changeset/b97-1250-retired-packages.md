---
"@zhin.js/cli": patch
"@zhin.js/gateway": patch
---

#1250 第 97 批：已并入、改名或停更的 `@zhin.js` 包与已删除的子路径（retired-package-not-flagged），以及 `zhin migrate` 的 pnpm 设置。

- `@zhin.js/gateway/project` 新增公开导出：常量 `RETIRED_ZHIN_PACKAGES`、`REMOVED_ZHIN_SUBPATHS`、`RETIRED_PACKAGES_DOCS_URL`，函数 `findRetiredZhinPackage(name)`、`findRemovedZhinSubpath(specifier)`、`findRetiredDependencies(manifest)`、`findRetiredImports(source)`，类型 `RetiredZhinPackage`、`RetiredPackageImport`、`RemovedZhinSubpath`、`RetiredDependency`、`RetiredImportUse`。
- 清单按仓库历史覆盖 registry 上已不在工作区的 28 个 `@zhin.js` 包：并入（`@zhin.js/config-yaml`、`@zhin.js/config-file`、`@zhin.js/isolate` 并入 `@zhin.js/runtime`，`@zhin.js/interaction` 并入 `@zhin.js/im-contract/interaction`，`@zhin.js/ai-provider` 并入 `@zhin.js/ai/provider`，`@zhin.js/console-types` 并入 `@zhin.js/contract`）、改名（`@zhin.js/plugin-test-kit` → `@zhin.js/testing`，`@zhin.js/adapter-process` → `@zhin.js/adapter-sandbox`，`@zhin.js/game-shared` → `@zhin.js/game-kit`，`@zhin.js/console-core` → `@zhin.js/pagemanager`，`@zhin.js/plugin-github-notify` → `@zhin.js/adapter-github`）、删除并由其他包接手（`@zhin.js/plugin-voice` → `@zhin.js/speech`，`@zhin.js/plugin-html-renderer`、`@zhin.js/satori` → `@zhin.js/html-renderer`，`@zhin.js/sensitive-filter` → `@zhin.js/plugin-content-moderation`）、删除且由 `zhin start` 装配取代（`@zhin.js/console`、`@zhin.js/console-app`、`@zhin.js/http`、`@zhin.js/http-host`、`@zhin.js/host-api`、`@zhin.js/host-router`、`@zhin.js/workroom`），历史里找不到接手者的（`@zhin.js/dependency`、`@zhin.js/devteam`、`@zhin.js/hmr`、`@zhin.js/queue-runtime`、`@zhin.js/storage-port`、`@zhin.js/types`）统一标为「已停更，无直接替代」，只提示删除依赖。`@zhin.js/config-yaml` 条目写明 `YamlConfigDocumentError` 改名为 `ConfigFileDocumentError`、两个错误类改为继承它。已删除的子路径 `@zhin.js/agent/tools` 指向 `@zhin.js/tool`（`defineAgentTool`）。文档新增「升级：已并入或停更的包」。
- `findRetiredImports` 线性扫描源码：跳过行注释与块注释，整体读取字符串字面量，所以注释和其他字符串里的写法不算；停更包只导出包根时，带子路径的 import 只给操作、不给替代路径。
- `zhin doctor` 新增「已停更的 Zhin 包」：根目录或 pnpm 工作区成员的 `package.json` 直接依赖清单中的包时给出警告，写明改用什么、删除这个依赖；源码 import 已删除的子路径时同样警告并列出文件与行号。
- 「Zhin 包单实例」报重复时，先沿依赖链指出是根项目或工作区成员的哪个直接依赖拖进了旧版本（如 `@zhin.js/config-yaml@1.1.0 → @zhin.js/runtime@1.1.0 → @zhin.js/plugin-runtime@1.1.9`），这份旧版本同时被工作区成员直接依赖时也照样指出；该依赖已停更时直接给出替代改法，同一个停更包拖进多份旧版本时只给一条，`pnpm.overrides` 只作为最后一条建议。
- `zhin migrate` 不再升级清单中的包，新增「已停更的 Zhin 包」一步，列出声明它们的 `package.json` 与项目源码中要改写的 import（文件与行号，含已删除的子路径）；不自动改写源码、不删除依赖。
- （行为变化）`zhin migrate`（含 `--include-pinned`）只在冷却期生效时才写 `minimumReleaseAgeExclude`：项目把 `minimumReleaseAge` 设为大于 0，或未设置但项目用 pnpm 11+。pnpm 11+ 只读 `pnpm-workspace.yaml` 的设置（不读 `package.json#pnpm`，`.npmrc` 只读认证与 registry 类设置）；pnpm 10 及更早或版本未知时还读项目 `.npmrc`（`minimum-release-age`）与 `package.json#pnpm`。`zhin doctor` / migrate 解释版本未装上的原因时按同样规则读取。
- （行为变化）确认 pnpm 10 及更早、且项目有 pnpm 会读的 `onlyBuiltDependencies` 列表时，网关原生依赖 `node-pty`、`ssh2`、`cpu-features` 一律只写进该列表，不再另写 `allowBuilds`；确认 pnpm 11 或版本未知时照写 `allowBuilds`（pnpm 11 只读 `allowBuilds`）。
