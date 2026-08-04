---
"@zhin.js/plugin-runtime": pa
"@zhin.js/cli": patch
---

fix(plugin-runtime): 发布 database host 新导出（`createPluginDatabaseHost` / `databaseRootHostToken`）

cli@3.0.0 的 `database-host-installer` 依赖这些导出，但当前 npm 上的 plugin-runtime@1.1.1 tarball 发布于导出加入之前，导致消费端 `SyntaxError: ... does not provide an export named 'createPluginDatabaseHost'`。需先发 plugin-runtime，再发 cli 使其锁到新版本。
