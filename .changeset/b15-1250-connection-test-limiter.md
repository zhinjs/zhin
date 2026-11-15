---
"zhin.js": patch
---

模型服务连接测试的限流（`/api/agent/inference/probe`、`/account/test`）只统计已存在的 Profile，未知的 Profile ID 不再占用计数；限流表最多记录 1024 个键，超出时丢弃最久未测试的键，内存不再随请求增长（zhinjs/zhin#1250）。
