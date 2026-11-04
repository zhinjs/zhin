---
title: "@zhin.js/adapter-onebot11"
package: "@zhin.js/adapter-onebot11"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/onebot11/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot11/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=13cd6b512247ec9f -->

# @zhin.js/adapter-onebot11

Zhin.js [OneBot 11](https://github.com/botuniverse/onebot-11) 适配器（Plugin Runtime）。生产路径为正向 WebSocket 客户端（`connection: ws`）；亦支持反向 WS（`connection: wss`，经 `httpHostToken`）。

账号由 `Onebot11Adapter` 管理。Endpoint 直接继承实际 `OneBotV11Client`，保留原生方法与事件；框架生命周期、规范入站与发送经 `endpointSpec` 和 AdapterIndex 接入，不占用 Client 的原生 `start` / `stop` / `send` 方法。

## 功能特性

- [OneBot 11 标准](https://github.com/botuniverse/onebot-11) 兼容（事件 + 动作）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 OneBot 实现的 WS 服务器
- `access_token` 鉴权（Bearer + query）
- 入站经 `endpointSpec.events`；出站 `send({ conversation, payload })`

## 安装

```bash
pnpm add @zhin.js/adapter-onebot11
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/onebot11/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `endpointSpec.events` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`

`AdapterIndex` 会把实例默认值与 `endpoints[]` 的逐项覆盖合并；协议层只接收一个已经展开的 endpoint 配置，不再读取嵌套 endpoint、旧 `type: ws_reverse` 别名或进程环境。

Endpoint 直接继承 `@imhelper/onebot-v11` 的 `OneBotV11Client`；当前操作的 `$client` 就是该实际实例。业务代码直接调用
`$client.call(action, params)` 和 Client 的公开平台能力；双工 WS 的 `echo` 响应由 Endpoint
先行分流，只有事件帧进入 Client 的 `ingest()` 和公开事件流。

入站：`endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })`（`conversation.kind` 为 `private`/`group`，`id` 为 uid/gid）

出站：`send({ conversation, payload })` → WS `send_private_msg` / `send_group_msg`（payload 已由 gateway/core 渲染；无 segment-mapper）

## 操作生命周期

每个实际 Client 的请求关联、定时器与取消由同一个实例级 RPC 模块持有。停止、删除或替换账号时，先取消该实例的等待，再关闭连接；已提交但未收到结果的请求保持“结果未知”，不会重试。框架发送与内容读取还绑定各自的操作信号，取消单个操作不影响其他操作或账号。原生 SDK 方法和事件重载保持不变。

## 前置条件

1. 启动兼容 OneBot 11 的实现，并选定正向或反向 WebSocket。
2. 正向 WS 需 Zhin 可达实现端；反向 WS 需实现端可达 Zhin HTTP Host。
3. 两端配置相同的 `access_token`，生产环境不要开放无鉴权连接。

## 最小配置

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  onebot11: "@zhin.js/adapter-onebot11"
onebot11:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: ob11-bot
      url: "ws://127.0.0.1:6700"
      access_token: "${ONEBOT11_ACCESS_TOKEN}"
```

主配置 `plugins` 映射需引用 `@zhin.js/adapter-onebot11`（`instanceKey: onebot11`）。

## 连接方式

| connection | 状态 |
|------------|----------------|
| `ws` | 已实现（推荐） |
| `wss` | 已实现：反向 WS（`httpHostToken`） |

## 鉴权

- **Bearer**：`Authorization: Bearer <access_token>`
- 正向 WS 在 Upgrade 时附带请求头，并在 URL query 写入 `access_token`

## 动作与事件

- 事件：`post_type`（message/notice/request/meta_event）、`message_type`、`message` 等
- 动作：`send_private_msg`、`send_group_msg`、`delete_msg`、`set_group_special_title` 等

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `PERMITS.md` |
| 平台工具 | `tools/set_title/index.ts` → `onebot11_set_title` |
| 技能说明 | `agents/onebot11/skills/onebot11/SKILL.md` |

## 迁移说明（Plugin Runtime）

- **notice / request / meta 侧事件**：经统一 `endpointSpec.events` 归一后分发到 `handlers`；消息仍走 `outboundMessageToken`。
- **群管工具暂未迁移**：旧 Adapter 经 `createSceneManagementTools` 注册踢人 / 禁言 / 群名片等成套 agent 工具；迁移后仅保留 `onebot11_set_title`，其余群管能力可通过 `$client.call()`（如 `set_group_kick`、`set_group_ban`）作为逃生舱调用。
- **平台权限门禁**：`plugin.ts` setup 通过 generation-owned `permissionHostToken` 调用 `host.registerPlatform('onebot11', createSceneRolePlatformChecker())`，`scene_admin` / `scene_owner` 依据入站 metadata 中的 sender `role`（owner / admin）判定。

## 文档链接

- [OneBot 11 标准](https://github.com/botuniverse/onebot-11)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## Console 页面

启动后打开 Console 的「OneBot 11」页（地址 `/onebot11`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 经所属 Adapter 增删持久化账号、启停单个 Endpoint；凭据由 Host 加密仓储保存，不改启动 YAML 或 `.env`，不重启进程；
- 如果适配器要求登录，页面会显示 LoginAssist 的扫码 / 滑块 / 设备确认待办；

读取需要 `onebot11:read`，写操作需要 `onebot11:write`；管理员 full token 不受限。页面里的「添加 endpoint」等价于原来的 `onebot11 endpoint add`。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WS 无法建立 | 核对连接方向、URL、端口与实现端 WS 服务 |
| 401 或握手关闭 | 确认 Header/query token 与实现端一致 |
| 能收不能发 | 检查发送动作支持与账号风控状态 |
| notice/request 不出现 | 确认实现端上报对应 post type，并查看 Endpoint 请求/通知 |

## 许可证

MIT License

### 高阶消息支持边界

OneBot11 标准支持链接分享：canonical share 的 url/title/description/image 分别映射标准 url/title/content/image，保留标题与描述。具体桥是否实现需实机确认；NapCat 的 share 发送限制不能以标准支持推断通过。标准没有 Markdown 与 keyboard 段，直接出站明确 `unsupported_operation / not_sent`；文字交互降级不能算原生按钮支持。参考：[OneBot11 消息段规范](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md)。
