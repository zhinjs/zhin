---
"@zhin.js/runtime": patch
"@zhin.js/gateway": patch
"@zhin.js/pagemanager": patch
"@zhin.js/testing": patch
---

#1250 第 94 批：生产实例的常驻内存。

- `--no-watch` 不再分析依赖（prod-runs-dependency-index）：`NativeDevelopmentModuleRuntime` 新增选项 `dependencyTracking: 'eager' | 'lazy'`（开 `watch` 时默认 `eager`，否则 `lazy`）。`lazy` 时加载模块不做导入分析，也不加载 `es-module-lexer`（它的 WebAssembly 内存涨上去就不回落）和依赖索引；第一次显式重载（Agent 自改代码经 `RootHost.reloadSources()`）时才按已提交的入口分析一次，此后随加载保持更新。`?zhin-generation=` 的版本号照旧记录，显式重载仍能换代。新增公开 API：`ModuleRuntime` 可选方法 `prepareInvalidation()`（HMR 协调器在每个重载事务的依赖查询前等待它）、`NativeDevelopmentModuleRuntime.prepareInvalidation()` 与选项 `dependencyTracking`；`@zhin.js/pagemanager` 的 `ClientBuildModuleRuntime` 与 `@zhin.js/testing` 的测试模块运行时转发该方法。依赖图建立前，`affectedSources()` 只返回文件本身，`requiresProcessRestart()` 对辅助模块保守地要求重启。
- 实例不再加载脚手架向导（instance-still-loads-cli-bits）：网关里实例也会导入的模块（`@zhin.js/gateway/iam` 的 Console 初始化服务、`@zhin.js/gateway/plugin-management` 的插件事务与官方插件候选）改为首次用到时才动态加载 `@zhin.js/scaffold-wizard`。`officialPluginCatalog()` 改为返回 `Promise`。`puppeteer-core` 不是本仓库任何包的依赖（`@zhin.js/html-renderer` 用 `@pixel.js/shotium`），实例里的它来自项目里的第三方插件。新增测试检查 `zhin.js/instance` 的静态导入图里没有 `@zhin.js/scaffold-wizard`、`@zhin.js/cli`、`puppeteer-core`、`inquirer`、`typescript` 和 `es-module-lexer`。
- 文档（tsx-loader-for-one-jsx-file）：命令编写页写明项目里的 `.tsx` 文件会让实例常驻 tsx 和 esbuild 子进程（约 16MB），以及不用 JSX 的 `.ts` 写法；生产部署页说明 `--no-watch` 的实例不分析依赖。tsx 加载器本来就只在第一次加载 `.tsx` 失败后才注册，没有 `.tsx` 的项目不受影响。
