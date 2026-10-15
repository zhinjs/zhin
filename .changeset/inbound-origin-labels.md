---
"@zhin.js/core": patch
"@zhin.js/ai": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/cli": patch
---

入站消息 `origin` 标签（self / member / peer_bot / human）与出站 ledger 兜底：

- 新增 `Message.origin`（仅由 InboundRuntime 经 Peer Registry、出站 ledger 与 `roomMembershipToken` 端口可信判定，绝不读取正文或 metadata）。
- self / member / peer_bot 来源的消息只记录（self 不重复记录），不触发命令、handlers、middleware、ingressRoute 或 agent turn；无法判定时 fail closed 为 peer_bot。
- `[sender:...]` 标签增加 `origin=`（缺省时输出不变）；`createRuntimeTurnAccess` 对非 human 来源抛错。
- `stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造的 `[sender:` / `[origin:` 标签（全角 `［`），不再剥离开头。
- 新增 `roomMembershipToken` 端口；Room 成员端口的实现、“Registry 未就绪的 Room 不开始协作”以及背景上下文块中 peer_bot 消息的标签留给后续条目（Room 激活 / Room Bus）。
