---
"@zhin.js/agent": patch
"@zhin.js/core": patch
"@zhin.js/im-contract": patch
---

私聊里发起人自己按原文存下的消息不再算作外部内容来源（zhinjs/zhin#1250 `own-unhandled-message-counts-as-background`，ADR 0067 D8）。

- 行为变化：私聊里本回合发起人自己更早发的、没被处理的纯文本消息（例如不是指令的 `/clear`）再以背景消息出现时，不再让回合算作「读过外部内容」，之后建定时任务不再因此要求确认。只认同一平台、同一 endpoint、同一会话里与发起人同一 sender id、带核心入站原文证据的 `message.created`；群聊、频道、别人发的、带引用 / 转发 / 媒体 / @、被改写或缺少证据的消息照旧计来源。
- 行为变化：没被任何指令处理的 `/clear`、`/reset`、`/new`（任意大小写，半角或全角斜杠）在私聊或 @ 机器人时得到一句固定提示，说明清空本会话请发「清空」（或 clear、重置），主人或受信任用户也可用 `<指令前缀>reset` 归档会话；入站结局记 `suggested`（`reset_hint`）。这句提示与清空 / `reset` 的固定回复按原文送达时记入本会话投递记录，下一回合不计来源。
- `@zhin.js/im-contract`：`ConversationMessage` 新增可选 `inboundTextDigest`，`ConversationContextBlock` 新增可选 `inboundActorId` / `inboundTextDigest`。
- `@zhin.js/core`：`ConversationRuntime.recordIncoming` 只对有发送者、无引用、纯文本且未被认领码脱敏改动的入站消息写原文摘要；聚合背景块时按存储内容重算核对后才给出证据，更新过的消息与出站消息永远没有。
