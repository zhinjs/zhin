---
"@zhin.js/console-protocol": patch
"@zhin.js/host-http": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/gateway": patch
---

Console Host 侧诊断数据修正（#1250），新字段均为可选、旧客户端不受影响：

- `endpoint.friends` / `groups` / `channels` / `group_members`：适配器不提供该读取时不再返回 `{ error }`，而是空列表加 `status: 'unsupported'`、`capability`、`message`（协议类型 `ConsoleEndpointCapabilityUnsupported` / `ConsoleEndpointListReply`，判定函数 `isConsoleEndpointCapabilityUnsupported`）。
- `endpoint.send_message` 失败时在 `data` 中带出 `{ code, reason, status, retryable? }`（`ConsoleSendFailure`；`reason` 为 `no_live_client` / `endpoint_offline` / `endpoint_not_found` / `target_not_found` / `policy_rejected` / `platform_rejected` / `unsupported` / `invalid_content` / `delivery_unknown` / `failed`），`error` 改为对应中文原因；Core 失败回执的消息带上失败码（`Outbound delivery failed (<code>).`）。
- MCP 客户端记录最近一次连接失败（`auth` / `network` / `timeout` / `config` / `process_exit` / `sdk_missing` / `unknown` + 脱敏短消息 + 退出码），写入 warn 日志（`op=mcp_connect_failed`），并经 Agent introspection 与 `GET /api/introspection/mcp` 返回 `status`（`connected` / `failed` / `idle` / `not_loaded`）与 `lastError`。
- 进程资源：`GET /api/system/status` 新增 `process`（`role: 'instance'`，与 `memory` 同一次采样）；`gateway.instance.status` 新增 `gateway`（`role: 'gateway'`，网关进程自身）。协议类型 `ConsoleProcessSample`。
- `gateway.packages.list` 每个已安装依赖带 `kind`（`plugin` / `feature` / `library`，取自 `package.json#zhin.type`），Console 只应把 `plugin` 当插件。
- `chat-roles.*` 条目新增 `grantedByDisplayName`：调用者本人授予的记录显示其显示名，聊天内授予、配置迁移、初始化令牌给出可读标签；其他 Console 账号不解析（实例不读取网关账号库）。
