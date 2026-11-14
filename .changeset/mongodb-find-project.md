---
"@zhin.js/database": patch
---

MongoDB 选择字段的查询（`select('id', …)` 等）改用驱动游标的 `project()`，原先调用不存在的 `projection()`，会报 `cursor.projection is not a function`。不选字段的查询不受影响。
