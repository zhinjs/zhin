---
"@zhin.js/agent": patch
"@zhin.js/core": minor
"@zhin.js/im-contract": patch
"@zhin.js/adapter": minor
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-discord": patch
---

私聊里发起人自己按原文存下的消息不再算作外部内容来源（zhinjs/zhin#1250 `own-unhandled-message-counts-as-background`，ADR 0067 D8）。

- 行为变化：私聊里本回合发起人自己更早发的、没被处理的纯文本消息（例如不是指令的 `/clear`）再以背景消息出现时，不再让回合算作「读过外部内容」，之后建定时任务不再因此要求确认。只认声明了 `messaging.inboundTextAuthoredBySender` 的适配器、同一平台、同一 endpoint、同一会话里与发起人同一 sender id（发起人来源须为 `human`）、带核心入站原文证据的 `message.created`；未声明能力的适配器、带转发标记的消息、群聊、频道、别人发的、带引用 / 转发 / 媒体 / @、被改写或缺少证据的消息照旧计来源。
- 行为变化：清空与 `<指令前缀>reset` 的固定回复按原文送达时，以带 `key:` 前缀的会话键记入本会话投递记录，下一回合不把它算作背景来源（`/clear`、`/reset`、`/new` 本身的处理见同批 b67 changeset：直接清空本会话上下文）。
- `@zhin.js/adapter`（新增公开能力位）：能力画像 `messaging` 新增 `inboundTextAuthoredBySender`，声明本适配器入站的文本段都是发送者亲笔（转发、引用、卡片表示为非文本段、`replyTo` 或 `forwarded` 标记）；没声明按不保证处理。
- `@zhin.js/im-contract`：`ConversationMessage` 新增可选 `inboundTextDigest`，`ConversationContextBlock` 新增可选 `inboundActorId` / `inboundTextDigest`。
- `@zhin.js/core`（新增公开字段）：`IncomingMessage` 新增可选 `forwarded`；`ConversationRuntime` 构造参数新增可选 `{ evidenceKey }`，`recordIncoming` 新增可选第三个参数 `{ textAuthoredBySender }`。入站链按适配器画像传入声明；只对声明了能力、有发送者、无转发标记、无引用、纯文本（纯文本视图与文本段一致、非空）且未被认领码脱敏改动的入站消息写原文证据。证据是以实例进程内随机密钥计算的 HMAC-SHA256，绑定会话、消息、发送者 id 与原文；聚合背景块时按存储内容重算核对后才给出，进程重启后旧证据失效。发送者 id 去掉首尾空白后存储。
- `@zhin.js/adapter-telegram`：转发（`forward_origin` 与旧版 `forward_*`）、自动转发、inline bot 结果（`via_bot`）、跨会话引用（`external_reply`、`quote`）的入站消息带 `forwarded: true`；新增导出 `isTelegramRelayedMessage`；声明 `inboundTextAuthoredBySender`。
- `@zhin.js/adapter-onebot11`、`@zhin.js/adapter-napcat`：CQ 字符串上报格式下，`[CQ:reply,id=…]` 解析为 `replyTo`；串里出现 reply 以外的 CQ 码（at、face、卡片、转发、markdown、媒体等）、不合规的方括号，或 `message` 与 `raw_message` 不一致时，入站消息带 `forwarded: true`，不写原文证据（失败关闭）。NapCat 不再把原始 CQ 串包成单个文本段，纯文本视图改为剥掉 CQ 码后的文本，与 OneBot11 一致（判定见 `src/protocol.ts` 的 `inspectCqString` / `isCqStringRelayed`）。
- `@zhin.js/adapter-sandbox`、`@zhin.js/adapter-onebot11`、`@zhin.js/adapter-napcat`、`@zhin.js/adapter-discord`：核实入站转发 / 引用 / 卡片都不以纯文本段出现后声明 `inboundTextAuthoredBySender`。
