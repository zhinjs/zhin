---
"@zhin.js/plugin-runtime": patch
"@zhin.js/core": patch
"@zhin.js/handler": patch
---

提供只读 SnapshotLease.retirementSignal，在运行代退休时及时结束交互等待，同时保留旧操作的 lease 排空语义。
问答在发送提示前建立精确会话与发送者约束，发送异常撤销等待；原生回答使用每题独立的短 callback token，避免旧按钮回答新问题。
