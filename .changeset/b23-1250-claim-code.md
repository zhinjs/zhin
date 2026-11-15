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
- 认领开启期间（尚无全局 owner），含有当前认领码的消息（不论写法：`认领:码`、`認領 码`、全角、码被空格拆开、后面带字或标点）在入站最早处由认领处理器接手：不交给 AI，不写入会话历史、trace、日志与诊断（日志与消息事件里只显示 `认领 ***`）；群聊里的码立即作废；被丢弃的带码消息（其他机器人贴出、会话未就绪）也作废码；含码的原生 `platform.receive` 事件不派发给原生 Handler。私聊里「认领 <一个词>」但码不对时回复错误并计次。不含当前码的消息（如群聊「claim it」）照常进 AI；已有 owner 后完全不拦截。
- 会话记录（`conversation_events`、Agent 会话消息）与 trace 的写入端加了兜底：只把当前开启的认领码写成 `***`，没有开启的认领时不做替换。
- `zhin status`、启动日志、「需要你处理」与自助提示的用法改为「在私聊中直接发送」。
- 新增公开导出：`@zhin.js/kernel` 的 `matchChatOwnerClaimText()` / `containsChatOwnerClaimCode()` / `registerChatOwnerClaimCode()` / `redactChatOwnerClaimText()`；`@zhin.js/core/runtime` 的 `InboundSecretGuard`（`match` / `inspectNative`）/ `InboundSecretMatch`（`handle` / `discard`）与 `ImRuntimeOptions.inboundSecret`。
