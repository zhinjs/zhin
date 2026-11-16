---
"zhin.js": patch
---

修复 `zhin trace --engagements` 报 `this[#db].select is not a function`（#1250 第 21 批 `trace-engagements-crash`）：协作事件日志改为通过数据库模型读写，与 Agent Host 的接法一致。
