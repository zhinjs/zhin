---
"@zhin.js/database": patch
---

SQLite / PostgreSQL / MySQL 的 `quoteIdentifier` 现在会成对转义标识符里的引号字符（`"` → `""`，`` ` `` → ``` `` ```），避免含引号的字段名破坏生成的 SQL。
