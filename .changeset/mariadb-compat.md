---
"@zhin.js/database": patch
"@zhin.js/core": patch
---

MariaDB 兼容性修复（由新增的 MariaDB 实库验证发现）：
- 索引文本列的排序规则按服务器选择：MySQL 8.0+ 用 `utf8mb4_0900_bin`，MariaDB 用 `utf8mb4_nopad_bin`（MariaDB 11.4 之前没有 0900 排序规则，建表会报 `Unknown collation`），MySQL 5.7 用 `utf8mb4_bin`。
- Console 只读 SQL 的超时在 MariaDB 上改用 `max_statement_time`（秒）；MariaDB 没有 `max_execution_time`，之前每条只读查询都会失败。
- 结构编辑器修改列时，按 MariaDB 的 `COLUMN_DEFAULT` 写法（带引号的字面量、裸表达式、字符串 `NULL`）还原默认值；之前会把 `current_timestamp()` 当成字符串，导致 `Invalid default value`。
