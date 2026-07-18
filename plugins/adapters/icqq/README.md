# @zhin.js/adapter-icqq

ICQQ Plugin Runtime 适配器 — 通过 [@icqqjs/cli](https://github.com/icqqjs/cli) 守护进程 IPC 连接已登录 QQ 账号（无 `httpHostToken`）。

## 功能特性

- 群聊 / 私聊 / 群临时会话 / QQ 频道消息
- 入站：`messageGatewayToken`（IPC 事件订阅）
- 出站：`send({ target, payload })` → `send_group_msg` / `send_private_msg` / …
- Agent 工具：`agent/tools/`（戳一戳、群管、好友列表等）保留

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
- **notice / request 入站事件已移除**：Plugin Runtime 的 `MessageGateway` 仅有 message 通道，没有 `notice.receive` / `request.receive` 事件机制，旧 `icqq-side-events.ts` / `get-msg.ts` / `login-ipc-contract.ts` / `agent-prompt.ts` 随之删除。需要好友/入群请求处理能力时请等待 runtime 提供事件通道后再恢复。

## License

MIT
