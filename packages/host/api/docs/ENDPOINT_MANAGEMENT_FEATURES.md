# Endpoint 管理面契约

Remote Console 的 Endpoint 页面同时兼容 legacy `@zhin.js/host-api` 与 Plugin Runtime `@zhin.js/host-http`。两条 Host 实现必须满足同一 wire interface，UI 不得按平台名称推断能力。

## 传输

- RPC：`POST /api/console/request`
- 实时推送：`GET /api/events`（SSE）
- canonical 名称和 payload 兼容：`@zhin.js/console-protocol`
- 浏览器消费入口：`@zhin.js/client`

旧 `endpoint:*` camelCase 名称仅作为 Host/SDK 入站兼容别名；新 Host、插件和 UI 只生成 `endpoint.*`、`request.*`、`inbox.*` 及 `message.receive` 等 canonical 名称。

## Endpoint summary

`endpoint.list` 与 `endpoint.info` 返回共享的 `ConsoleEndpointSummary`：

- `name`、`adapter`、`connected`、`status`
- 可选 `phase`、`owner`、待处理计数
- `managementCapabilities`：从 live Endpoint 的 `EndpointManagement` 实际方法自动推导

稳定能力值：`listFriends`、`listGroups`、`listChannels`、`listGroupMembers`、`approveRequest`、`rejectRequest`、`kickGroupMember`、`muteGroupMember`、`setGroupAdmin`、`deleteFriend`。

Console 按能力值展示好友/群/频道目录和管理操作；没有目录能力时可以从统一收件箱恢复最近会话。

## EndpointManagement seam

平台 Adapter 负责 SDK 方法别名、标识符转换和结果归一化。Host 只消费 `EndpointManagement` 语义端口，不探测 `getFriendList`、`getGuilds` 等平台方法。

Plugin Runtime 装配使用 `ImRuntime.getEndpointManagement()`；旧的 raw Endpoint resolver 只保留一轮入站兼容，不用于新装配。

## RPC

- `endpoint.friends`、`endpoint.groups`、`endpoint.channels`
- `endpoint.group_members`
- `endpoint.delete_friend`
- `endpoint.group_kick`、`endpoint.group_mute`、`endpoint.group_admin`
- `request.list`、`request.approve`、`request.reject`
- `inbox.messages`、`inbox.requests`、`inbox.notices`

请求字段先由 `normalizeConsoleRpcMessage()` 统一；Host 内部只处理 canonical `$adapter`、`$endpoint`、`$channel_id` 等字段。

## 验证

```bash
pnpm vitest run packages/host/api/tests/endpoint-summary-contract.test.ts
pnpm vitest run packages/host/http/tests/console-rpc-extended.test.ts
ZHIN_CONSOLE_DIR=/path/to/zhinjs/console pnpm check:console-contract
```

最后一项会 pack 本仓库的 protocol/client，在干净 Console 副本中安装 tarball 并生产构建，避免 workspace 或手工覆盖 `node_modules` 掩盖发布问题。
