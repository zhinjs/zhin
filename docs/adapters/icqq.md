---
title: "@zhin.js/adapter-icqq"
package: "@zhin.js/adapter-icqq"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/icqq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=712c4bbd46abfdbd -->

# @zhin.js/adapter-icqq

ICQQ Plugin Runtime 适配器 — 进程内直接使用 [@icqqjs/icqq](https://github.com/icqqjs/icqq) `Client`

## 功能特性

- 群聊 / 私聊 / 群临时会话 / QQ 频道消息
- 入站：`messageGatewayToken`，文本与图片 / 语音 / 视频 / 文件统一归一为 canonical `Segment` + `MediaRef`
- 出站：canonical Segment 直接投影为 ICQQ 原生 `Sendable`，再由 `sendGroupMsg` / `sendPrivateMsg` / …发送
- 群聊 reaction：`control.addReaction` / `removeReaction`（协议 ACK 失败不阻塞后续发送）
- Agent 工具：包根 `tools/`（`@zhin.js/tool` Feature；模型侧名为 `icqq__send_user_like` 等）
- Console Endpoint 管理：`src/endpoint.ts` 显式实现 `EndpointManagement`（好友/群/群成员列表、请求审批、删好友、踢人、禁言、设管理）

## 安装

```bash
pnpm add @zhin.js/adapter-icqq @icqqjs/icqq
# 可选：未配置 signApiAddr 时走本地签名
pnpm add @icqqjs/qqsign
```

`@icqqjs/icqq` 是适配器的**可选对等依赖**（`peerDependencies` + `optional`）。应用侧需自行安装；monorepo 内另在 `devDependencies` 声明以便构建/测试。

`@icqqjs/*` 发布在 GitHub Packages，需：

```ini
@icqqjs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

并设置具有 `read:packages` 权限的 `NPM_TOKEN`（CI 使用仓库 secret `PERSONAL_TOKEN`）。

签名：未配置 `signApiAddr` 时，若已安装 `@icqqjs/qqsign` 则自动走本地签名。

## 前置条件

1. 准备可登录的 QQ 账号，并选择远程 `signApiAddr` 或安装本地 `@icqqjs/qqsign`。
2. 确保运行目录可持久化设备与登录状态；容器部署应挂载对应数据目录。
3. 首次登录可能要求二维码、滑块或设备确认，可在 Console 登录待办或终端完成。

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
- `outboundMedia: file | base64`：`file` 在发送期间把 segment base64 物化为临时文件并于发送结束清理；`base64` 使用 ICQQ 原生支持的 `base64://` file 参数。
- ICQQ 的语音、视频、文件是独立消息元素；它们与其他段混发时适配器会明确拒绝，避免协议栈静默丢段。
- 入站语音 / 视频在 Endpoint 持有原生 Client 时解析可下载 URL；解析失败则保留真实平台引用，不伪造或丢弃媒体。
- **Console 社交/群管 RPC 已接线**：endpoint 把好友/群/群成员列表、请求审批和群管操作归一化为冻结的 `EndpointManagement`。Host 只消费该语义端口。
- 好友/入群请求与通知：经 `sideEventGatewayToken` 分发到 `handlers`（`notice.receive` / `request.receive`）；审批走 `Request.$approve` / `EndpointManagement.approveRequest`。Console `request.list` 优先读 `management.listRequests()`（`getSystemMsg`），不再写入 `unified_inbox_request/notice`。
- `system.*`（登录扫码等）分发到 `system.receive`。
- **登录辅助**：`system.login.qrcode|slider|device|auth` 经 `loginAssistToken`（`LoginAssist`）挂起待办；刷新后可用 Console `login.list` / `login.submit` 或终端 stdin 继续（对齐 icqq 官方 stdin 流程）。`system.online` / `login.error` 会清理该 endpoint 待办。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 一直停在登录中 | 打开 Console 登录待办，完成二维码、滑块或设备确认 |
| 签名失败 | 检查 `signApiAddr`；本地模式确认 `@icqqjs/qqsign` 已安装且版本匹配 |
| 重启后重复登录 | 持久化设备与会话数据目录，避免每次生成新设备 |
| 请求或通知未显示 | 在 Endpoint 详情检查请求视图；ICQQ 优先读取平台请求列表 |

## License

MIT
