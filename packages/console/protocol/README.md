# @zhin.js/console-protocol

Zhin Console 的零依赖 wire contract：规范 RPC 名称、兼容别名、payload 字段和 demo scope 策略。

Host 应先调用 `normalizeConsoleRpcMessage()`，再进行鉴权和运行时分发；平台与运行时差异不应进入本包。

Client transport 应调用 `normalizeConsolePushMessage()`；需要持久化 Inbox 时调用 `parseConsoleInboxEvent()`，不要在调用方再次解析旧事件名、`$adapter`、`bot` 或 `endpoint_id` 等兼容字段。
