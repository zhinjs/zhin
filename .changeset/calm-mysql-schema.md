---
"@zhin.js/database": patch
"@zhin.js/cli": patch
---

修复 MySQL 8.4 初始化：TEXT/JSON 默认值生成表达式语法，文本主键与唯一键使用可完整索引的 VARCHAR，并避免向数据库驱动透传框架的 dialect 配置。
