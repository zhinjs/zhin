---
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-kook": patch
---

飞书 / KOOK 查询群主与管理员时，缓存失效那一刻同一个群（服务器）的并发消息共用一次查询，不再各自调用一次接口。
