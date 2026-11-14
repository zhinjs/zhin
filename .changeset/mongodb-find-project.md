---
"@zhin.js/database": patch
---

MongoDB 查询改用驱动游标的 `project()` 选择字段（原先调用不存在的 `projection()`，任何 find 都会报 `cursor.projection is not a function`）；没有选择字段时不再投影。
