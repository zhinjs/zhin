---
"@zhin.js/scaffold-wizard": patch
"@zhin.js/cli": patch
---

`zhin doctor` / `zhin config check` 不再在配置有 `database:` 块时误报 ❌ 缺少 `@zhin.js/database`：它是 `zhin.js` 自己的依赖，能经已安装的 `zhin.js` 解析时视为已提供（诊断结果新增 `providedByZhin`）。依赖修复命令在 pnpm workspace 根（脚手架项目都有 `pnpm-workspace.yaml`）里改为 `pnpm add -w …`，避免 `ERR_PNPM_ADDING_TO_ROOT`。`@zhin.js/scaffold-wizard` 新增导出 `formatPnpmAddCommand`、`resolvesThroughZhin`，`formatZhinStackFixCommand` / `formatAIDependencyFixCommand` 新增可选参数 `cwd`（#1250）。
