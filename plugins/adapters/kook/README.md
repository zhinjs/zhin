# @zhin.js/adapter-kook

Zhin.js KOOK（开黑啦）适配器（Plugin Runtime），默认通过 **WebSocket Gateway**（`kook-client`）收发消息；可选 **Webhook** 模式经 `httpHostToken` 接收平台 POST 推送。

## 功能

- WebSocket Gateway 入站（默认；无需公网 HTTPS / host）
- Webhook 入站（`connection: webhook` + `httpHostToken` + `verify_token`）
- 解析频道与私聊文本消息
- 出站 `send({ target, payload })` → KOOK KMarkdown（`channel:id` / `private:id`）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-kook
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/kook.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/host-http` — Webhook 模式 POST 路由（WebSocket 不需要）
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **WebSocket 路径无需** `@zhin.js/host-http` / `@zhin.js/host-router`

入站：`gateway.receive({ adapter, target: 'channel:…'|'private:…', content, sender, metadata })`  
出站：`send({ target, payload })` → `sendChannelMsg` / `sendPrivateMsg`

## 前置条件

| 要求 | 说明 |
|------|------|
| **Bot Token** | 在 [KOOK 开发者平台](https://developer.kookapp.cn/) 创建应用并获取 |
| **邀请入服** | 将机器人邀请到目标服务器，并授予查看频道、发送消息等权限 |
| **WebSocket（默认）** | `kook-client` 正向连接；无需公网 URL |
| **Webhook** | 需公网 HTTPS + Host `httpHostToken`；与 WebSocket 互斥 |
| **host-http** | 仅 Webhook 模式需要 |

必填字段：`token`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  kook:
    name: my-kook-bot
    token: ${KOOK_TOKEN}
    # connection: websocket   # 默认
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
    name: my-kook-bot
    token: ${KOOK_TOKEN}
    connection: webhook
    verify_token: ${KOOK_VERIFY_TOKEN}
    webhookPath: /kook/webhook
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

platform permit checker 已在 `plugin.ts` 注册到 legacy registry（`registerPlatformPermitChecker`），但新 Runtime Tool 链路（`@zhin.js/tool` / capability-ingress）暂不消费 `permissions` / permit 声明，待工具权限模型定义后接线。`agent/tools` 中的 `platformPermit(...)` 声明目前不产生门禁效果。

## 迁移后出站能力变化

迁移到 Plugin Runtime 后，出站统一经 `messageGatewayToken` 渲染为文本后发送（`sendChannelMsg` / `sendPrivateMsg`，KMarkdown 文本）。旧 Adapter 的富媒体出站能力（图片 / 卡片消息 / 附件等多模态 segment 直发）暂未迁移，当前出站等价于纯文本（KMarkdown）。如需发送卡片或附件，可直接使用 endpoint 上的 KOOK OpenAPI 封装（`getRoleList` 等同款 client）作为逃生舱。

## 许可证

MIT License
