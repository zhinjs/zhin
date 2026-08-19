# @zhin.js/adapter-icqq

ICQQ Plugin Runtime 适配器 — 进程内直接使用 [@icqqjs/icqq](https://github.com/icqqjs/icqq) `Client`（无独立守护进程、无 `httpHostToken`）。

## 功能特性

- 群聊 / 私聊 / 群临时会话 / QQ 频道消息
- 入站：`messageGatewayToken`，归一为 `gateway.receive({ conversation, message, content, ... })`
- 出站：`send({ conversation, payload })` → `sendGroupMsg` / `sendPrivateMsg` / …（conversation kind/id/parent 路由）
- 群聊 reaction：`control.addReaction` / `removeReaction`（协议 ACK 失败不阻塞后续发送）
- Agent 工具：包根 `tools/`（`@zhin.js/tool` Feature；模型侧名为 `icqq__send_user_like` 等）
- Console Endpoint 管理：`src/endpoint.ts` 显式实现 `EndpointManagement`（好友/群/群成员列表、请求审批、删好友、踢人、禁言、设管理）

## 安装

适配器本身不捆绑协议库，需在**应用项目**中同时安装 `@icqqjs/icqq`（及可选的本地签名 `@icqqjs/qqsign`）：

```bash
pnpm add @zhin.js/adapter-icqq @icqqjs/icqq
# 可选：未配置 signApiAddr 时走本地签名
pnpm add @icqqjs/qqsign
```

`@icqqjs/icqq` 为 `@zhin.js/adapter-icqq` 的**可选对等依赖**——仅在使用 ICQQ 适配器时由应用侧安装。仓库 CI 不安装该包；适配器源码通过 `src/icqqjs-icqq.d.ts` 做类型检查。

签名：未配置 `signApiAddr` 时，若已安装 `@icqqjs/qqsign` 则自动走本地签名。

## 配置（Plugin Runtime）

```yaml
plugins:
  icqq:
    master: "1659488338"        # 必填，顶层共享（/approve 与 master 角色）
    autoReconnect: true
    endpoints:
      - id: "${ICQQ_ACCOUNT}"   # QQ 号
        # password: "${ICQQ_PASSWORD}"  # 可选；不填则扫码登录
```

多账号：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`id` 必填）：

```yaml
plugins:
  icqq:
    master: "1659488338"
    endpoints:
      - id: "${ICQQ_ACCOUNT}"
      - id: "${ICQQ_ACCOUNT_2}"
      - id: "${ICQQ_ACCOUNT_3}"
```

## Send conversation

| 类型 | conversation |
|------|--------------|
| 私聊 | `{ kind: 'private', id: uin }` |
| 群聊 | `{ kind: 'group', id: gid }` |
| 群临时会话 | `{ kind: 'private', id: uin, parent: { kind: 'group', id: gid } }` |
| 频道 | `{ kind: 'channel', id: channelId, parent: { kind: 'channel', id: guildId } }` |

## 架构

- `plugin.ts` + `adapters/icqq.ts`（`defineAdapter`）
- Endpoint：`src/endpoint.ts`（继承 icqq `Client`，`start()` 内 `login()`）
- 协议常量 / 配置：`src/protocol.ts`
- Agent 工具：`tools/*.ts`；权限说明见 `agent/PERMITS.md`

## Plugin Runtime 迁移说明

- 不再经过 `@icqqjs/cli` IPC 守护进程；登录态与协议栈都在本进程。
- `autoReconnect`：Client 断线后按配置自动重连（`stop()` 为主动断开，不触发重连）。
- `outboundMedia: file | base64`：`file` 把 segment base64 落盘后发本地路径；`base64` 发 CQ `base64://` 内联。
- **Console 社交/群管 RPC 已接线**：endpoint 把好友/群/群成员列表、请求审批和群管操作归一化为冻结的 `EndpointManagement`。Host 只消费该语义端口。
- 好友/入群请求与通知写入 unified inbox（有 DatabaseHost 时），不再走已删除的 `notice.receive` / `request.receive` 事件。

## License

MIT
