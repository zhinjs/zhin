# @zhin.js/adapter-kook

Zhin.js KOOK（开黑啦）适配器（Plugin Runtime），默认通过 **WebSocket Gateway**（`kook-client`）收发消息；可选 **Webhook** 模式经 `httpHostToken` 接收平台 POST 推送。

## 功能

- WebSocket Gateway 入站（默认；无需公网 HTTPS / host）
- Webhook 入站（`connection: webhook` + `httpHostToken` + `verify_token`）
- 解析频道与私聊文本消息
- 出站 `send({ conversation, payload })` → KOOK KMarkdown（`kind: 'channel' | 'private'`）
- canonical `markdown` 段原生保留为 [KMarkdown](https://developer.kookapp.cn/doc/kmarkdown-desc)
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-kook
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/kook.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/host-http` — Webhook 模式 POST 路由（WebSocket 不需要）
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **WebSocket 路径无需** `@zhin.js/host-http` / `@zhin.js/host-router`

入站：`gateway.receive({ conversation, message, content, sender, metadata })`（ConversationRef：`channel` 频道消息带 guild `parent`，`private` 私聊）  
出站：`send({ conversation, payload })` → `sendChannelMsg` / `sendPrivateMsg`

## 前置条件

| 要求 | 说明 |
|------|------|
| **Bot Token** | 在 [KOOK 开发者平台](https://developer.kookapp.cn/) 创建应用并获取 |
| **邀请入服** | 将机器人邀请到目标服务器，并授予查看频道、发送消息等权限 |
| **WebSocket（默认）** | `kook-client` 正向连接；无需公网 URL |
| **Webhook** | 需公网 HTTPS + Host `httpHostToken`；与 WebSocket 互斥 |
| **host-http** | 仅 Webhook 模式需要 |

必填字段（`endpoints[i]`）：`name`、`token`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  kook:
    # connection: websocket   # 默认
    endpoints:
      - name: my-kook-bot
        token: ${KOOK_TOKEN}
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-kook`（`instanceKey: kook`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `KOOK_TOKEN` / `KOOK_BOT_TOKEN` | Bot Token |
| `KOOK_BOT_NAME` | 可选，默认 endpoint 名 |
| `KOOK_VERIFY_TOKEN` | Webhook 模式 verify token |
| `KOOK_ENCRYPT_KEY` | 可选，Webhook 消息加密密钥 |
| `KOOK_WEBHOOK_PATH` | 可选，默认 `/kook/webhook` |

## Webhook

在 KOOK 开发者后台选择 **WebHook** 连接模式，Callback URL 指向 Host 暴露的公网地址（建议在 URL 加 `?compress=0` 便于调试）。

```yaml
plugins:
  kook:
    connection: webhook
    webhookPath: /kook/webhook
    endpoints:
      - name: my-kook-bot
        token: ${KOOK_TOKEN}
        verify_token: ${KOOK_VERIFY_TOKEN}
        # encrypt_key: ${KOOK_ENCRYPT_KEY}   # 启用消息加密时必填
```

Host 需注入 `httpHostToken`。Challenge（`type: 255`）会校验 `verify_token` 并回显 `challenge`；普通事件经 `gateway.receive` 入站，出站仍走 KOOK HTTP API。

## AI 工具（Skill）

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具 | `agent/tools/`（角色、黑名单等） |
| 技能说明 | `agent/skills/kook.md` |

## 平台权限（platform permit）

platform permit checker 由 `plugin.ts` 的 generation 生命周期注册；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具的 platform permit 声明。

## 迁移后出站能力变化

迁移到 Plugin Runtime 后，出站统一经 `messageGatewayToken` 渲染并由 endpoint 编码为 KMarkdown（`sendChannelMsg` / `sendPrivateMsg`）。canonical `markdown` 保留格式；图片、视频、音频和文件仅有远程 URL 时可表示为 KMarkdown 链接。卡片消息与附件上传仍未接入统一出站通道。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WebSocket 无法上线 | 检查 Bot Token、网络与机器人能力开关 |
| Webhook challenge 失败 | 检查公网路径、`verify_token` 与 HTTP Host |
| 频道消息未触发 | 检查应用订阅、频道权限与机器人是否已加入服务器 |
| 附件表现为链接 | 当前统一出站不上传附件；使用远程 URL 或按能力降级 |

## 许可证

MIT License
