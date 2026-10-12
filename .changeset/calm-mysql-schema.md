---
"@zhin.js/database": patch
"@zhin.js/cli": patch
---

修复 MySQL 8.4 初始化：TEXT/JSON 默认值生成表达式语法，文本主键与唯一键使用可完整索引的 VARCHAR，并避免向数据库驱动透传框架的 dialect 配置。

文本索引保留大小写与末尾空格区别，并在建表前校验长度和 InnoDB 页大小；新表固定使用 DYNAMIC 行格式。
