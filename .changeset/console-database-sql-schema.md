---
"zhin.js": patch
"@zhin.js/core": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/host-http": patch
"@zhin.js/console-protocol": patch
"@zhin.js/database": patch
---

Console 数据库页：服务端排序筛选、只读 SQL、写 SQL 与表结构编辑：

- `db:select` 支持 `orderBy: { column, direction }`（全表排序，主键作为次序键保证分页稳定）；`where` 只接受表中存在的列与 `$eq/$ne/$gt/$gte/$lt/$lte/$like/$nlike/$in/$nin`（`null` 表示为空/不为空），修复列名未转义可拼入 SQL 的问题。`db:info` 返回 `capabilities`，Console 据此判断 Host 是否支持新功能。
- 新增 `db:query`（`ops.database.read`）：单条只读语句（SELECT / WITH / EXPLAIN / SHOW / 只读 PRAGMA），在只读事务中执行（SQLite `query_only`、PostgreSQL `READ ONLY` + `statement_timeout`、MySQL `START TRANSACTION READ ONLY` + `max_execution_time`），最多返回 1000 行。
- 新增权限 `ops.database.schema`（内置角色中仅 `owner` 拥有）与 `db:execute`（写 SQL，可多语句，`dryRun` 在事务中执行后回滚以预估影响行数）、`db:schema:describe` / `db:schema:preview` / `db:schema:apply`（加列、改列名、删列、改类型/可空/默认值、建表、建/删索引；删除类操作需输入名称确认）。网关 `console_*` 表、迁移记录表与引擎系统表拒绝写入与结构调整；写 SQL 与结构调整的语句文本写入审计日志（不记录结果行）。MongoDB / Redis / memory 方言返回不支持。
- 未由代码声明的物理表（Console 新建或已卸载插件留下的表）在启动时被发现并出现在表列表中。
- `@zhin.js/database`：PostgreSQL / MySQL 事务支持 `readOnly`；PostgreSQL 查询结果数组带不可枚举的 `command` / `rowCount`。
