# @zhin.js/console-protocol

Zhin Console 的零依赖 wire contract：规范 RPC 名称、payload 字段和 demo scope 策略。

Host 只接受常量表声明的 canonical RPC 名称和顶层 camelCase payload。Inbox 响应也只暴露 camelCase DTO；数据库 snake_case 行只存在于 Host 内部。平台与运行时差异不应进入本包。

Client transport 直接消费 canonical dot-named push；需要持久化 Inbox 时调用 `parseConsoleInboxEvent()` 校验事件形状。

## Event stream

`ConsoleEventEnvelope` 是 SSE 与 `GET /api/events/history` 共用的权威事件形状，身份为 `(runtimeId, eventId)`。`parseConsoleSseFrame()` 按标准 SSE 规则保留 `event:` 和 `id:`，并读取 Zhin 的 `runtime:` / `timestamp:` 扩展字段。

历史响应使用 `ConsoleEventHistoryPage`。当 `gap=true` 时，调用方必须从对应领域的 HTTP 投影完整重同步，不能把当前有界后缀误认为完整历史。

通知投影使用 `ConsoleInboxNoticesQuery` / `ConsoleInboxNoticesResult`；传入 `unreadOnly: true` 可从持久化 Inbox 重建未读通知，而不是依赖本地实时内存。
