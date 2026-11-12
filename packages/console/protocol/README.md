# @zhin.js/console-protocol

Zhin Console 的零依赖 wire contract：规范 RPC 名称、payload 字段，以及 Console 访问控制（[ADR 0049](../../../docs/adr/0049-console-rbac.md)）的权限目录与权限表。

## 权限

每个 Console RPC、每条 `{base}` 下的 HTTP 路由、每个由 Host 认证的 WebSocket 都必须在本包的权限表里登记；没登记的对所有已登录主体（包括所有者）一律拒绝。新增路由、RPC 或 Socket 时在这里加一行。

| 导出 | 内容 |
| --- | --- |
| `CONSOLE_PERMISSIONS` / `CONSOLE_PERMISSION_LIST` | 内置权限目录（`status.view`、`endpoint.*`、`feature.*`、`agent.*`、`plugin.manage`、`ops.*`、`iam.*` 等） |
| `CONSOLE_BUILTIN_ROLES` / `CONSOLE_BUILTIN_ROLE_NAMES` | 内置角色 `owner` / `admin` / `operator` / `viewer` 及其权限 |
| `CONSOLE_SCOPED_PERMISSIONS`、`CONSOLE_WRITE_PERMISSIONS` | 可绑定到适配器 / 账号作用域的权限；写类权限（写操作记入审计） |
| `CONSOLE_RPC_PERMISSIONS`、`resolveConsoleRpcPermission()` | RPC 类型 → 权限；插件 RPC（`plugin.<id>.*`）按插件声明的权限逐方法检查 |
| `CONSOLE_HTTP_PERMISSIONS`、`resolveConsoleHttpPermission()` | `{base}` 相对路径与方法 → 权限 |
| `CONSOLE_WS_PERMISSIONS`、`resolveConsoleWsPermission()` | 由 Host 认证的 WebSocket 路径 → 权限（如 `/sandbox` 需要 `endpoint.operate`） |
| `bindingScopeCovers()`、`grantsAllow()`、`featureScopeTarget()` | 全局 / 适配器 / 账号绑定的作用域判断；会话键按所属账号计 |
| `CONSOLE_PLUGIN_PERMISSION_LEVELS`、`inferConsolePluginPermissionLevel()` 等 | 插件权限（`<插件>:<动作>`）的级别 `read` / `operate` / `manage`，内置角色经 `plugin.perms.*` 按级别授予 |
| `IAM_RPC`、`ONBOARDING_RPC`、`CONSOLE_AUTH_ROUTES` | 账号、角色、令牌、审计 RPC，引导 RPC，`/auth/*` 路由 |
| `GATEWAY_RPC`（`GATEWAY_PACKAGES_RPC`、`GATEWAY_INSTANCE_RPC`、`GATEWAY_PLUGINS_RPC`）、`GATEWAY_RPC_PERMISSIONS` | 管理网关自己处理的 `gateway.*` RPC：依赖事务、实例起停与日志、插件声明 |
| `FEATURE_RPC`、`FEATURE_RPC_PERMISSIONS` | 分层功能配置 `feature.*`（全局 / 适配器 / 账号 / 会话，ADR 0050 / 0055） |
| `CHAT_ROLES_RPC`、`CONSOLE_CHAT_ROLES` | 聊天角色 `chat-roles.list` / `grant` / `revoke`（`iam.manage`，ADR 0056） |
| `CONSOLE_PAGE_SECTIONS` | Console 导航分区（ADR 0052） |

完整的页面与权限说明见 [访问控制](../../../docs/console/access-control.md)。

## Wire 约定

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


`CONFIG_RPC.EXPLAIN` (`config:explain`) is a read of saved-field metadata that requires `ops.config.read`.
It requires an exact `instanceKey` and the saved source's `expectedRevision`.
`ConsoleConfigExplanation` binds the response to that file/project revision and generation;
its `ConsoleConfigFieldEvidence` paths are static Schema property arrays, with candidate
origins and current-generation agreement only. It never contains values, defaults,
environment variable names/expanded values, or historical generation origins. Unsupported
instances/schemas return a bounded reason and no partial fields.

首版仅解释静态对象中的标量字段；固定字符串常量联合（Console 表单作为选项编辑的 `anyOf` + `const`）按字符串标量解释，元素为标量的列表（如框架注入的 `disabledCommands`）整体作为一个字段解释。除此之外，Schema 任一处含对象数组、元组、字典、组合分支或引用时，
整份解释返回 `complex-schema`，不返回部分标量证据。这不影响已有配置读取、校验或源码编辑，
也不表示复杂表单或默认来源已完整支持。字段数量、路径深度与响应大小超限同样明确返回
`bound-exceeded`，不静默截断。未声明 Schema 的插件返回 `schema-unavailable`。

当前仓库中 Reminder、Repeater 的对象/标量声明属于该范围；Calendar 的 provider union
会触发 `complex-schema`，GroupSuite、RSS 未声明配置 Schema，返回 `schema-unavailable`。
这些是当前声明的覆盖示例，不保证未来插件新增复杂字段后仍可解释。
