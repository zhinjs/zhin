---
title: "@zhin.js/adapter-icqq"
package: "@zhin.js/adapter-icqq"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/icqq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=3c99ac74519c6956 -->

# @zhin.js/adapter-icqq

ICQQ Plugin Runtime 适配器 — 通过 [@icqqjs/cli](https://github.com/icqqjs/cli) 守护进程 IPC 连接已登录 QQ 账号（无 `httpHostToken`）。

## 功能特性

- 群聊 / 私聊 / 群临时会话 / QQ 频道消息
- 入站：`messageGatewayToken`（IPC 事件订阅）
- 出站：`send({ target, payload })` → `send_group_msg` / `send_private_msg` / …
- Agent 工具：`agent/tools/`（戳一戳、群管、好友列表等）保留
- Console endpoint RPC：`src/endpoint.ts` 已实现社交/群管探测面（好友/群/群成员列表、请求审批、删好友、踢人、禁言、设管理），console 的 `endpoint:friends/groups/groupMembers/requestApprove/...` 对 icqq 可用

## 安装

```bash
pnpm add @zhin.js/adapter-icqq
pnpm add -g @icqqjs/cli   # 或 npx icqq login
```

## 配置（Plugin Runtime）

```yaml
plugins:
  icqq:
    name: "${ICQQ_ACCOUNT}"   # QQ 号，须与 icqq login 一致
    autoReconnect: true
    # rpc:                    # 可选远程守护进程
    #   host: 10.0.0.2
    #   port: 9527
    #   token: ${ICQQ_RPC_TOKEN}
```

多账号：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`name` 必填）：

```yaml
plugins:
  icqq:
    master: "1659488338"      # 顶层字段所有 endpoint 共享
    endpoints:
      - name: "${ICQQ_ACCOUNT}"
      - name: "${ICQQ_ACCOUNT_2}"
      - name: "${ICQQ_ACCOUNT_3}"   # 各账号须分别 icqq login
```

先执行 `icqq login`，再启动 Zhin。

## Send target

| 类型 | target |
|------|--------|
| 私聊 | `private:uin` |
| 群聊 | `group:gid` |
| 群临时会话 | `temp:gid:uin` |
| 频道 | `channel:guildId:channelId` |

## 架构

- `plugin.ts` + `adapters/icqq.ts`（`defineAdapter`）
- 协议常量 / 配置：`src/protocol.ts`
- IPC 客户端：`src/ipc-client.ts`（无 host-http）
- Console loginAssist / host-router 延期
- 旧 `usePlugin` / `extends Adapter` / Endpoint 生产入口已删除

## Plugin Runtime 迁移说明

- `autoReconnect` 已恢复实现：IPC/RPC 意外断开后按指数退避自动重连（`stop()` 为主动断开，不触发重连）。
- `outboundMedia: file | base64` 已恢复实现：`file` 模式把 segment base64 落盘为临时文件后发 `[image:path]`；`base64` 模式（配置 `rpc` 时默认）发 `[image:base64://...]` 由守护进程解码。
- **Console 社交/群管 RPC 已接线**：endpoint 实例暴露 `getFriendList` / `getGroupList` / `getGroupMemberList`（含 `listMembers` / `getMemberList` 别名）、`approveRequest` / `rejectRequest`（经 `get_system_msg` 按 flag/seq 定位后路由 `handle_friend_request` / `handle_group_request`）、`deleteFriend`（别名 `delete_friend`）、`removeMember`（别名 `kickMember` / `setGroupKick`）、`muteMember`（别名 `banMember` / `setGroupMute`，duration 秒）、`setModerator`（别名 `setAdmin` / `setGroupAdmin`），另有 `friends` / `groups` Map 缓存，均被 console-rpc-extended 按名探测调用。
- **notice / request 入站事件已移除**：Plugin Runtime 的 `MessageGateway` 仅有 message 通道，没有 `notice.receive` / `request.receive` 事件机制，旧 `icqq-side-events.ts` / `get-msg.ts` / `login-ipc-contract.ts` / `agent-prompt.ts` 随之删除。需要好友/入群请求处理能力时请等待 runtime 提供事件通道后再恢复。

## License

MIT
