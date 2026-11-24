---
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-bilibili": patch
"@zhin.js/adapter-juejin": patch
"@zhin.js/adapter-ipad-wechat": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-kook": patch
---

**入站不再等上一条消息的 Agent 回合**：确认卡按钮、对追问的回答不会再卡到交互超时（#1250）。

- 此前这些适配器在取下一条入站前，会等上一条消息派发结束。派发会持续整轮 Agent 回合；如果回合正在等用户点确认卡按钮或回答追问，下一条入站就取不到，直到交互超时：Telegram 轮询不再发 getUpdates，微信 iLink 不再长轮询，邮件跳过之后的收信检查，B 站、掘金评论轮询不再排下一轮，iPad 微信的投递迟迟不 ACK。Discord 交互回调要等回合结束才响应，会超过 3 秒的 ACK 时限；KOOK Webhook 也要等回合结束才响应。
- `@zhin.js/adapter` 的事件端口新增 `events.admit(callback)` 和 `events.handoff(name, payload)` / `events.handoffMessage(input)`。`admit` 与 `run` 是同一个接收凭据，但只等回调本身，回调里交出去的派发仍挂在这个凭据上，close/stop 照样等它结束。`handoff` 在 Runtime 接下事件时 resolve，没接下时 reject，派发结果放在返回的 `dispatched` 上。`events.run` 和 `events.emitAccepted` 的语义不变。
- `@zhin.js/core` 记下入站消息之后、路由派发之前通知适配器「已接下」（`EndpointEvent.accepted`）。在这之前失败（例如入站存储不可用），交接仍然算失败：Telegram 不推进 update offset，Webhook 回 503；微信 iLink 不推进同步游标；邮件不把 UID 记为已收，下次检查会重新取到。接下之后派发失败，只记日志（`*_dispatch_failed`），不会被平台重投。
- 各适配器原有的顺序、去重和游标推进时机不变，只是从「派发结束」提前到「交给 Runtime」。
