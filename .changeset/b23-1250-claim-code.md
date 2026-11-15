---
"@zhin.js/kernel": minor
"@zhin.js/core": minor
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/cli": patch
---

认领码（ADR 0060 §3.3，zhinjs/zhin#1250 第 23 批）：

- 在私聊中直接发送「认领 <码>」/「claim <码>」即可认领，不再需要适配器的命令前缀（带前缀的 `#认领 <码>` 仍然有效）。此前配了 `commandPrefix` 的账号上，按提示发送的消息没有匹配到命令，被当作普通聊天交给了 AI。
- 认领开启期间（尚无全局 owner），认领形态的消息（关键词在最前、后面恰好一个词）在入站最早处由认领处理器接手：不交给 AI，不写入会话历史、trace、日志与诊断（日志与消息事件里只显示 `认领 ***`）；群聊、Sandbox 中直接回复简短的拒绝说明，码不对时同样不进 AI。「我想认领这个任务」这类普通聊天不受影响。
- 会话记录（`conversation_events`、Agent 会话消息）与 trace 的写入端加了兜底：认领形态行里的码写成 `***`。
- `zhin status`、启动日志、「需要你处理」与自助提示的用法改为「在私聊中直接发送」。
- 新增公开导出：`@zhin.js/kernel` 的 `matchChatOwnerClaimText()` / `redactChatOwnerClaimText()`；`@zhin.js/core/runtime` 的 `InboundSecretGuard` / `InboundSecretMatch` 与 `ImRuntimeOptions.inboundSecret`。
