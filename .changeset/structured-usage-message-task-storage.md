---
"@zhin.js/database": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/im-contract": patch
"@zhin.js/tool": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-rss": patch
---

新增独立于日志的 Agent 用量分字段存储，默认保留 30 天；为消息与会话增加可查询身份及状态字段。提醒、管理员 RSS 和 Agent 计划任务使用事务化 SQL 表，迁移保留认领与回执，未知投递不自动重发。修复跨连接事务隔离、拒绝传播和 PostgreSQL 长度字段兼容。支持 SQLite、MySQL、PostgreSQL，升级需备份并完整重启，不能与旧版本进程混写。
