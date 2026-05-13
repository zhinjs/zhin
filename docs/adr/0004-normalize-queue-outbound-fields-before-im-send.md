# IM 发送前先规范化队列出站字段

队列出站 payload 在变成 `SendOptions` 前，必须先经过 Core 的 field-contract 模块规范化。这样 `context`、`adapter`、`channelId`、`id`、`content`、`text` 等队列别名会在 Queue 到 IM 的边界被明确处理，而不是让每个 producer 或 adapter 自行解决冲突。

