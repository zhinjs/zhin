# IM 发送前先规范化队列出站字段

队列出站 payload 在变成 `SendOptions` 前，必须先经过 Core 的 field-contract 模块规范化。这样 `context`、`adapter`、`channelId`、`id`、`content`、`text` 等队列别名会在 Queue 到 IM 的边界被明确处理，而不是让每个 producer 或 adapter 自行解决冲突。

## Proactive 出站（Amended 2026-07）

非入站回复类 IM 出站（定时任务、通知、子 agent 回告、协作 proactive、ask_user 私聊等）须经 **`sendProactive`**（[`packages/im/agent/src/outbound/send-proactive.ts`](../../packages/im/agent/src/outbound/send-proactive.ts)）：

- Dispatcher `OutboundReplyStore` 扩展 `trigger: 'inbound' | 'proactive'` 与 `proactiveSource`
- `runWithOutboundPolish` 在 ALS 内执行 `Adapter.sendMessage`，与 `replyWithPolish` 共享 `before.sendMessage` 润色链
- **禁止**业务路径直调 `endpoint.$sendMessage`；Activity Feedback message 类亦走 Adapter.sendMessage

## 相关

- [ADR 0025 — Adapter AI 结构化出站](./0025-adapter-ai-outbound-json.md)
