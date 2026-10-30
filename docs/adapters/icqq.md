---
title: "@zhin.js/adapter-icqq"
package: "@zhin.js/adapter-icqq"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/icqq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=d895e828b13c2f2d -->

# @zhin.js/adapter-icqq

ICQQ Plugin Runtime 适配器 — 进程内直接使用 [@icqqjs/icqq](https://github.com/icqqjs/icqq) `Client`

## 功能特性

- 群聊 / 私聊 / 群临时会话 / QQ 频道消息
- 入站：ICQQ Client 原始事件经 `Endpoint.emit(...)` 唯一入口上送；文本与图片 / 语音 / 视频 / 文件统一归一为 canonical `Segment` + `MediaRef`
- 出站：canonical Segment 直接投影为 ICQQ 原生 `Sendable`，再由 `sendGroupMsg` / `sendPrivateMsg` / …发送
- 群聊 reaction：`control.addReaction` / `removeReaction`（协议 ACK 失败不阻塞后续发送）
- Agent 工具：按职责拆分在 `agents/icqq/skills/icqq-*/tools/`，只在对应 Skill 激活后披露
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
configVersion: 2
plugins:
  icqq: "@zhin.js/adapter-icqq"
icqq:
  master: "1659488338" # 必填，顶层共享（/approve 与 master 角色）
  autoReconnect: true
  endpoints:
    - id: "${ICQQ_ACCOUNT}" # QQ 号
      # password: "${ICQQ_PASSWORD}"  # 可选；不填则扫码登录
```

多账号：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`id` 必填）：

```yaml
configVersion: 2
plugins:
  icqq: "@zhin.js/adapter-icqq"
icqq:
  master: "1659488338"
  endpoints:
    - id: "${ICQQ_ACCOUNT}"
    - id: "${ICQQ_ACCOUNT_2}"
    - id: "${ICQQ_ACCOUNT_3}"
```

`AdapterIndex` 会先合并插件实例默认值与 endpoint 覆盖值，再把一份完整配置交给
ICQQ adapter。协议层只接受这份展开后的 endpoint 配置，不读取环境变量，也不再次解析
嵌套的 `endpoints`。环境变量替换由 composition root 在配置加载阶段完成。

## Send conversation

| 类型 | conversation |
|------|--------------|
| 私聊 | `{ kind: 'private', id: uin }` |
| 群聊 | `{ kind: 'group', id: gid }` |
| 群临时会话 | `{ kind: 'private', id: uin, parent: { kind: 'group', id: gid } }` |
| 频道 | `{ kind: 'channel', id: channelId, parent: { kind: 'channel', id: guildId } }` |

## 直接使用完整 ICQQ Client

适配器把 `icqq` 注册为 `@icqqjs/icqq.Client` 与 SDK `EventMap` 的类型判别项。
所有 Feature 都使用同一个 `adapter` 字段完成类型缩窄与运行时过滤：

```ts
import { defineHandler } from 'zhin.js/handler'
import '@zhin.js/adapter-icqq'

export default defineHandler({
  adapter: 'icqq',
  event: 'request.group.add',
  async handle({ client, event }) {
    await client.setGroupAddRequest(event.flag, true)
  },
})
```

`client` 就是当前账号的真实 ICQQ SDK 实例，不是 Endpoint facade。未知扩展事件可显式使用
`event: '*'`；此时 Client 类型保持完整，事件 payload 为 `unknown`。普通消息回复仍应走
`Message.$reply`；群管理、请求审批与 ICQQ 专属查询可直接调用当前事件的 `client`。

Command context 的 `$client` 是按需读取的 getter：

```ts
export default defineCommand({
  adapter: 'icqq',
  async execute(context) {
    await context.$client.sendLike(Number(context.sender!.id), 10)
    return 'ok'
  },
})
```

Middleware 使用同一个判别字段；不声明 `adapter` 时 `$client` 的类型是 `unknown`：

```ts
export default defineMiddleware<Message>({
  target: 'inbound',
  adapter: 'icqq',
  async handle(context, next) {
    console.log(context.$client.uin, context.input.content)
    await next()
  },
})
```

Agent tool 的 IM turn 同样直接读取当前 Client：

```ts
export default defineAgentTool({
  adapter: 'icqq',
  description: '获取群列表',
  async execute(_input, context) {
    return context.$client.getGroupList()
  },
})
```

`adapter` 缺失时 `$client` 静态类型为 `unknown`；声明后若实际 operation 不属于 ICQQ，
运行时会在执行前拒绝。Client 只能在当前 operation 内使用。task、schedule 或 Host 等脱离
IM turn 的场景，才使用 `icqqClient.get(context, endpointId)` 显式选择账号。

## 架构

- `plugin.ts` + `adapters/icqq/index.ts`：Plugin Runtime 入口与 `defineAdapter` 声明
- `src/endpoint.ts`：组合 ICQQ `Client`，只协调账号 transport、Zhin lifecycle 与各能力端口
- `src/content-resolver.ts`：保存已观察消息，并按深度和条数限制递归展开合并转发
- `src/icqq-inbound.ts`：把 ICQQ 原生消息归一为 Zhin 入站消息
- `src/protocol.ts`：配置解析、会话映射与出站目标转换
- `src/client.ts`：向插件作者暴露 ICQQ `Client` / `EventMap` 类型注册
- Agent 工具：`agents/icqq/skills/icqq-*/tools/<name>/index.ts`；权限说明见 `PERMITS.md`

阅读适配器实现时从 `endpoint.ts` 看能力装配，再进入对应能力文件。包外代码只从
`@zhin.js/adapter-icqq` 与 `zhin.js/adapter` 的公开入口导入，不依赖上述源码路径。

## Plugin Runtime 迁移说明

- 不再经过 `@icqqjs/cli` IPC 守护进程；登录态与协议栈都在本进程。
- `autoReconnect`：Client 断线后按配置自动重连（`stop()` 为主动断开，不触发重连）。
- `outboundMedia: file | base64`：`file` 在发送期间把 segment base64 物化为临时文件并于发送结束清理；`base64` 使用 ICQQ 原生支持的 `base64://` file 参数。
- ICQQ 的语音、视频、文件是独立消息元素；它们与其他段混发时适配器会明确拒绝，避免协议栈静默丢段。
- 入站语音 / 视频在 Endpoint 持有原生 Client 时解析可下载 URL；解析失败则保留真实平台引用，不伪造或丢弃媒体。
- **Console 社交/群管 RPC 已接线**：endpoint 把好友/群/群成员列表、请求审批和群管操作归一化为冻结的 `EndpointManagement`。Host 只消费该语义端口。
- 好友/入群请求与通知：经 the unified `Endpoint.emit(...)` ingress 分发到 `handlers`（`notice.receive` / `request.receive`）；审批走 `Request.$approve` / `EndpointManagement.approveRequest`。Console `request.list` 优先读 `management.listRequests()`（`getSystemMsg`），不再写入 `unified_inbox_request/notice`。
- `system.*`（登录扫码等）分发到 `system.receive`。
- **登录辅助**：`system.login.qrcode|slider|device|auth` 经 `loginAssistToken`（`LoginAssist`）挂起待办；刷新后可用 Console `login.list` / `login.submit` 或终端 stdin 继续（对齐 icqq 官方 stdin 流程）。`system.online` / `login.error` 会清理该 endpoint 待办。

## Agent 会话与消息操作

ICQQ Agent 可按需加载 `icqq-conversation` 查询当前群／频道和 Bot 自身角色。`icqq-messages` 提供当前会话的引用回复、真实消息合并转发和撤回自己发言；自己的消息撤回不要求群管身份或逐次审批，时限由平台决定。

`icqq-group-admin` 新增撤回他人消息与退群：前者保留群管发起权限、实时平台角色检查，无需逐次审批；退群仅主人可发起、每次审批，Bot 为群主时拒绝执行。引用／转发走统一发送链路，不支持跨会话转发。当前 guild-channel 接入仅提供身份查询，不能使用这些群／私聊操作。详见 [权限与能力说明](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/PERMITS.md)。

## Console 页面

启动后打开 Console 的「ICQQ」页（地址 `/icqq`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 增删 `plugins.icqq.endpoints`（凭据写入 `.env`，配置里只保留 `${ENV}` 引用）；
- 处理登录待办（扫码 / 滑块 / 设备确认等，来自 LoginAssist）；

ICQQ 首次登录的二维码、滑块、设备确认会出现在「登录待办」里，不需要再回到终端确认。

读取需要 `icqq:read`，写操作需要 `icqq:write`；管理员 full token 不受限。页面里的「添加 endpoint」等价于原来的 `icqq endpoint add`。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 一直停在登录中 | 打开 Console 登录待办，完成二维码、滑块或设备确认 |
| 签名失败 | 检查 `signApiAddr`；本地模式确认 `@icqqjs/qqsign` 已安装且版本匹配 |
| 重启后重复登录 | 持久化设备与会话数据目录，避免每次生成新设备 |
| 请求或通知未显示 | 在 Endpoint 详情检查请求视图；ICQQ 优先读取平台请求列表 |

## License

MIT

### 发送回执与未知结果

发送成功回执只接受平台真实消息 ID。网络超时、断线、缺少消息 ID 的响应会报告 `deliveryUnknown`，框架不会自动重发；手动重发可能重复发送。

ICQQ 原生分享和文件 API 可能已经成功，但只返回空值或文件 ID；这类结果不能当作可引用、可撤回的消息 ID。群聊和私聊的分享卡片发出后，适配器会读一次会话记录，找到机器人自己刚发出的卡片消息，用它的真实消息 ID 作为回执（记录有延迟时半秒后再读一次）。找不到时（以及临时会话、频道和文件）仍报告投递结果未知，不编造 ID。平台操作仍只执行一次。文件撤回应使用平台专用文件 API。

### 独立元素按顺序拆分发送

ICQQ 要求分享、文件、语音、视频、JSON 卡片和合并转发单独成条。一条消息里同时有文字和这些元素时（例如 Agent 回复“找到了：”加一张音乐分享卡片），适配器按原顺序拆成多条依次发送，引用只附在第一条普通消息上。

- 回执的消息 ID 取第一条拿到 ID 的部分；所有部分都没有 ID（如单独一张分享）时，仍报告投递结果未知。
- 第一条就失败时原样报告失败；后面的部分失败时报告 `partial_delivery`（结果未知），因为前面的部分已经送达，重发会重复。

## 语言

Endpoint 管理和工具反馈跟随当前操作语言；登录没有当前聊天发送者，LoginAssist 提示采用项目语言。提示文案变化不改变扫码、短信、滑块验证过程，群管理权限、审批与平台结果检查保持原规则。

Endpoint 添加用法中的调用头由当前环境的实际命令前缀与插件命名空间提供；未知时只提示所需参数，不生成猜测命令。
