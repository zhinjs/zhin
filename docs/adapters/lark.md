---
title: "@zhin.js/adapter-lark"
package: "@zhin.js/adapter-lark"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/lark/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/lark/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=88ee48e5390fd4ab -->

# @zhin.js/adapter-lark

Zhin.js 飞书 / Lark 适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能

- Webhook 事件接收（`httpHostToken` POST + 可选 verificationToken / encryptKey 签名）
- URL 验证挑战（`url_verification`）
- Tenant Access Token 自动刷新
- 支持飞书与 Lark 国际版 API 基址
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-lark
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/lark.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: chat_id, content: text, sender, metadata })`  
出站：`send({ target, payload })` → `im/v1/messages`

入站 `metadata.mentioned`：**未接线**。消息事件的 `mentions[]` 元素含 `id.open_id`，但本适配器拿不到 bot 自身的 open_id——配置（`appId` / `appSecret` / `name` 等）不含 bot open_id，代码也未调用 `bot/v3/info` 获取应用信息，故无可靠判据比对 mentions。

## 前置条件

1. 在 [飞书开放平台](https://open.feishu.cn/)（或 Lark）创建企业自建应用
2. 获取 **App ID**、**App Secret**
3. 启用机器人能力并配置事件订阅 URL：`https://your-domain/lark/webhook`
4. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段（`endpoints[i]`）：`name`、`appId`、`appSecret`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  lark:
    webhookPath: /lark/webhook          # 可选，默认 /lark/webhook
    isFeishu: true                      # 可选，默认 true
    # apiBaseUrl: https://open.feishu.cn/open-apis
    endpoints:
      - name: my-lark-bot
        appId: ${LARK_APP_ID}
        appSecret: ${LARK_APP_SECRET}
        # encryptKey: ${LARK_ENCRYPT_KEY}          # 可选
        # verificationToken: ${LARK_VERIFY_TOKEN}  # 可选
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-lark`（`instanceKey: lark`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `LARK_APP_ID` | 应用 App ID |
| `LARK_APP_SECRET` | 应用 App Secret |
| `LARK_BOT_NAME` | 默认 endpoint 名称（可选） |

## 消息类型映射

| 飞书类型 | 入站 content（文本摘要） | 出站 wire |
|----------|--------------------------|-----------|
| text | 原文 | text |
| image | `[image]` | image（需 `file_key`） |
| file | `[file: name]` | file |
| audio / video / sticker | `[audio]` / `[video]` / `[sticker]` | — |
| card | — | interactive |

## Agent 工具

`agent/` 目录保留（get_user、群聊、管理员、上传文件等）。Endpoint 在 `start` 时自注册到 `lark-agent-deps`。

## 平台权限（platform permit）

`plugin.ts` 在 generation setup 注册 `src/platform-permit.ts` checker，并在 dispose 注销；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具权限。

## 测试

```bash
pnpm --filter @zhin.js/adapter-lark build
pnpm --filter @zhin.js/adapter-lark test
```
