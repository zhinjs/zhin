# @zhin.js/adapter-qq

Zhin.js QQ 官方机器人适配器（Plugin Runtime），默认通过 **WebSocket Gateway**（`qq-official-bot`）收发消息（无需 host-router / host-http）。

## 功能

- WebSocket Gateway 入站（默认；无需公网 HTTPS / host）
- 解析私聊 / 群 / 频道消息
- 出站 `send({ conversation, payload })` → QQ API（`conversation.kind`/`id`/`parent` 结构化寻址）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Webhook / middleware 模式已实现（经 `httpHostToken` 注册 POST 路由）
- AI `@` 触发标注：群消息（GROUP_AT_MESSAGE_CREATE 仅 @ 时下发）与频道 `mentions[].bot` 会在入站 metadata 标 `mentioned: true`（新 Plugin Runtime 纯文本 content 经 metadata 传递 @）

## 安装

```bash
pnpm add @zhin.js/adapter-qq
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/qq.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **无需** `@zhin.js/host-http` / `@zhin.js/host-router`（WebSocket 路径）

入站：`gateway.receive({ conversation, message, content, sender, metadata })`（ConversationRef 结构化寻址）  
出站：`send({ conversation, payload })` → `sendPrivateMessage` / `sendGroupMessage` / `sendGuildMessage`

## 前置条件

| 要求 | 说明 |
|------|------|
| **AppID / Secret** | [QQ 开放平台](https://q.qq.com/) 创建机器人应用并获取 |
| **WebSocket（默认）** | `qq-official-bot` 正向连接；无需公网回调 |
| **host-http** | WebSocket **不需要**；Webhook / middleware 模式需要（经 `httpHostToken`） |

必填字段（`endpoints[i]`）：`name`、`appid`、`secret`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  qq:
    # mode: websocket   # 默认
    endpoints:
      - name: my-qq-bot
        appid: ${QQ_APPID}
        secret: ${QQ_SECRET}
        # botKind / intents 可由向导写入；`qq.endpoint add` 扫码后会追问公域/私域再写入
```

### botKind 与 intents

WebSocket Identify 的 `intents` **必须与开放平台已开通的权限一致**，否则会断连。
群聊无公/私域之分，两类都订阅 `GROUP_AND_C2C_EVENT`；差异只在频道消息 intent：

| `botKind` | 频道消息 intent | 共用 intents |
|-----------|-----------------|--------------|
| `public`（默认，公域） | `PUBLIC_GUILD_MESSAGES`（仅 @） | `GROUP_AND_C2C_EVENT`, `GUILDS`, `GUILD_MEMBERS`, `DIRECT_MESSAGE` |
| `private`（私域） | `GUILD_MESSAGES`（频道全量） | 同上 |

公域机器人订阅 `GUILD_MESSAGES` 会 Identify 失败断连。显式配置 `intents` 时优先于 `botKind`。
`create-zhin` / `zhin setup` 会询问公/私域并写入；`qq.endpoint add` 扫码成功后在同一会话追问 `public`/`private`（或 `公域`/`私域`），确认后一次性写 `.env` 与 yaml。

多账号：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`name` 必填）：

```yaml
plugins:
  qq:
    mode: websocket
    endpoints:
      - name: main-bot
        appid: ${QQ_APPID}
        secret: ${QQ_SECRET}
        botKind: public
        intents:
          - GROUP_AND_C2C_EVENT
          - GUILDS
          - GUILD_MEMBERS
          - DIRECT_MESSAGE
          - PUBLIC_GUILD_MESSAGES
      - name: private-bot
        appid: ${QQ_APPID_2}
        secret: ${QQ_SECRET_2}
        botKind: private
        intents:
          - GROUP_AND_C2C_EVENT
          - GUILDS
          - GUILD_MEMBERS
          - DIRECT_MESSAGE
          - GUILD_MESSAGES
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-qq`（`instanceKey: qq`）。

## Endpoint 管理命令

适配器自带 `qq.endpoint` 命令组（聊天内直接使用，默认无前缀；受 `commandPrefix` 影响）：

| 命令 | 说明 |
|------|------|
| `qq.endpoint add [name]` | 手机 QQ 扫码绑定 → **追问公域/私域** → 一次性写入 `.env` + `plugins.qq.endpoints`（重启生效） |
| `qq.endpoint cancel` | 取消进行中的扫码绑定或待确认的公域/私域选择 |
| `qq.endpoint list` | 列出运行中与配置中的 endpoints |
| `qq.endpoint remove <name>` | 从配置移除 endpoint（`.env` 键保留，可手动清理） |

add/cancel/remove 受 `master` 限制：实例配置声明了 `master`（顶层或 `endpoints[i].master`）时仅
master 可执行；未配置则放行（首个扫码绑定者会写入该 endpoint 的 `master`）。二维码当前以链接文本下发
（出站富媒体待迁移），用手机 QQ 打开链接即可扫码。

## 环境变量

| 变量 | 说明 |
|------|------|
| `QQ_APPID` / `QQ_BOT_APPID` | 应用 AppID |
| `QQ_SECRET` / `QQ_BOT_SECRET` | 应用 Secret |
| `QQ_BOT_NAME` | 可选，默认 endpoint 名 |

## Webhook / middleware

`mode: webhook` 或 `mode: middleware` 经 `httpHostToken` 注册 POST 路由（默认 `/qq/webhook`），使用 qq-official-bot Middleware 接收器验签并入站；出站仍走 QQ HTTP API。Host 需注入 `httpHostToken`。

## AI 工具（Skill）

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具 | `agent/tools/`（频道、角色等） |
| 技能说明 | `agent/skills/qq.md` |

## 平台权限（platform permit）

platform permit checker 由 `plugin.ts` 的 generation 生命周期注册；`@zhin.js/tool` descriptor 保留 `platforms` / `scopes` / `permissions`，CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 执行门禁。

## Markdown 与交互输出

QQ Endpoint 声明原生 `markdown` / `keyboard` 能力。普通 AI Markdown 会保留为 QQ Markdown
消息；命令或 Agent 通过 `UserInteraction.ask()` 发起 `confirm` / `select` 时，会生成
Markdown + 指令按钮组。按钮值与手动输入共用同一解析入口，不维护 QQ 专用交互状态。

不支持原生按钮的 Adapter 会在 Core 中把同一 keyboard 语义降级为编号列表，并保存数字到
payload 的回跳映射。图片、音频、视频和文件仍沿 canonical `MediaRef` 出站链投递。

## 许可证

MIT License
