---
"@zhin.js/gateway": minor
---

#1250 第 19a 批：`zhin console init` / Console 初始化向导选择与当前一致的数据库（例如默认 SQLite 下 `--database sqlite`）时不再写 `database:` 块、不再提示「切换数据库不会迁移旧库数据」、不再重启实例：`ConsoleSetupService.applyDatabase()` 返回 `changed: false`（新增 `SetupDatabaseApplyResult` 类型）。前台网关（`pnpm dev`）在 Console 未初始化时向交互终端打印带 `#token=` 的初始化链接（新增导出 `consoleSetupLink()`），令牌不写入日志文件。
