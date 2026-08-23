# @zhin.js/console-protocol

Zhin Console 的零依赖 wire contract：规范 RPC 名称、兼容别名、payload 字段和 demo scope 策略。

Host 应先调用 `normalizeConsoleRpcMessage()`，再进行鉴权和运行时分发；平台与运行时差异不应进入本包。

Client transport 应调用 `normalizeConsolePushMessage()`；需要持久化 Inbox 时调用 `parseConsoleInboxEvent()`，不要在调用方再次解析旧事件名、`$adapter`、`bot` 或 `endpoint_id` 等兼容字段。

## Event stream

`ConsoleEventEnvelope` 是 SSE 与 `GET /api/events/history` 共用的权威事件形状，身份为 `(runtimeId, eventId)`。`parseConsoleSseFrame()` 按标准 SSE 规则保留 `event:` 和 `id:`，并读取 Zhin 的 `runtime:` / `timestamp:` 扩展字段。

历史响应使用 `ConsoleEventHistoryPage`。当 `gap=true` 时，调用方必须从对应领域的 HTTP 投影完整重同步，不能把当前有界后缀误认为完整历史。

通知投影使用 `ConsoleInboxNoticesQuery` / `ConsoleInboxNoticesResult`；传入 `unreadOnly: true` 可从持久化 Inbox 重建未读通知，而不是依赖本地实时内存。
