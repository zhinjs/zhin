---
"@zhin.js/runtime": patch
---

隔离插件运行时新增 `startTimeoutMs`：`prepare`（启动 Worker / 进程并导入入口）默认使用 `requestTimeoutMs` 与 10 秒中的较大值，较短的单次调用超时不再让负载较高的主机在隔离实例启动阶段失败。
