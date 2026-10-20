# @zhin.js/console-protocol

Zhin Console 的零依赖 wire contract：规范 RPC 名称、payload 字段和 demo scope 策略。

Host 只接受常量表声明的 canonical RPC 名称和顶层 camelCase payload。Inbox 响应也只暴露 camelCase DTO；数据库 snake_case 行只存在于 Host 内部。平台与运行时差异不应进入本包。

Client transport 直接消费 canonical dot-named push；需要持久化 Inbox 时调用 `parseConsoleInboxEvent()` 校验事件形状。

## Event stream

`ConsoleEventEnvelope` 是 SSE 与 `GET /api/events/history` 共用的权威事件形状，身份为 `(runtimeId, eventId)`。`parseConsoleSseFrame()` 按标准 SSE 规则保留 `event:` 和 `id:`，并读取 Zhin 的 `runtime:` / `timestamp:` 扩展字段。

历史响应使用 `ConsoleEventHistoryPage`。当 `gap=true` 时，调用方必须从对应领域的 HTTP 投影完整重同步，不能把当前有界后缀误认为完整历史。

通知投影使用 `ConsoleInboxNoticesQuery` / `ConsoleInboxNoticesResult`；传入 `unreadOnly: true` 可从持久化 Inbox 重建未读通知，而不是依赖本地实时内存。

消息诊断中的 `dispatchStatus: 'limited'` 表示命令执行预算拒绝，仍属于已匹配命令，不能回落为 AI 输入。
`limit.reason` 为 `cooldown`、`busy`、`capacity`、`operation_unavailable`、`identity_unavailable` 或
`service_unavailable`。只有冷却含 `retryAfterMs`（剩余毫秒）；`busy` 不推测任务结束时间。
它与最终投递回执独立：拒绝说明本身仍可发送成功，也可能投递失败。


`CONFIG_RPC.EXPLAIN` (`config:explain`) is a full-scope read of saved-field metadata.
It requires an exact `instanceKey` and the saved source's `expectedRevision`.
`ConsoleConfigExplanation` binds the response to that file/project revision and generation;
its `ConsoleConfigFieldEvidence` paths are static Schema property arrays, with candidate
origins and current-generation agreement only. It never contains values, defaults,
environment variable names/expanded values, or historical generation origins. Unsupported
instances/schemas return a bounded reason and no partial fields. Demo scope is denied.

首版仅解释静态对象中的标量字段；固定字符串常量联合（Console 表单作为选项编辑的 `anyOf` + `const`）按字符串标量解释，元素为标量的列表（如框架注入的 `disabledCommands`）整体作为一个字段解释。除此之外，Schema 任一处含对象数组、元组、字典、组合分支或引用时，
整份解释返回 `complex-schema`，不返回部分标量证据。这不影响已有配置读取、校验或源码编辑，
也不表示复杂表单或默认来源已完整支持。字段数量、路径深度与响应大小超限同样明确返回
`bound-exceeded`，不静默截断。未声明 Schema 的插件返回 `schema-unavailable`。

当前仓库中 Reminder、Repeater 的对象/标量声明属于该范围；Calendar 的 provider union
会触发 `complex-schema`，GroupSuite、RSS 未声明配置 Schema，返回 `schema-unavailable`。
这些是当前声明的覆盖示例，不保证未来插件新增复杂字段后仍可解释。
