---
"@zhin.js/core": patch
---

入站按平台+会话+发送者+消息 id 去重，多 Endpoint 收到同一条群消息只路由一次，其余仅记录；去重判定出错 fail-closed 为仅记录
