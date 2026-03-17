# 适配器

适配器用于连接不同的聊天平台。每个适配器管理一个或多个 Bot 实例，负责消息收发和平台特定的 API 调用。

## 内置适配器

### Sandbox（本地测试）

```yaml
plugins:
  - "@zhin.js/adapter-sandbox"
```

在终端中直接输入消息测试，无需任何外部平台配置。开发调试首选。

### Process（进程适配器）

框架核心服务之一，在 `services` 中配置 `process` 即可启用。提供标准输入输出的消息交互。

## 平台适配器

### ICQQ（QQ - 非官方协议）

安装：

```bash
pnpm add @zhin.js/adapter-icqq
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-icqq"

bots:
  - context: icqq
    name: "${ICQQ_ACCOUNT}"       # QQ 号
    password: "${ICQQ_PASSWORD}"   # 密码（可选，不填则扫码登录）
    platform: 5                    # 登录平台 (1:安卓 2:iPad 3:Watch 5:Mac)
    scope: icqqjs
    data_dir: ./data
```

ICQQ 适配器通过覆写 `IGroupManagement` 方法自动注册群管理工具（踢人、禁言、设管理员、改名片等），同时提供平台特有工具（头衔、群公告、戳一戳等）。详见 [工具与技能](/advanced/tools-skills)。

### QQ 官方机器人

安装：

```bash
pnpm add @zhin.js/adapter-qq
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-qq"

bots:
  - context: qq
    name: qq-bot
    appid: "${QQ_APPID}"
    secret: "${QQ_SECRET}"
```

### KOOK

安装：

```bash
pnpm add @zhin.js/adapter-kook
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-kook"

bots:
  - context: kook
    name: kook-bot
    token: "${KOOK_TOKEN}"
```

### Discord

Discord 适配器**一个适配器**支持 Gateway（WebSocket）与 Interactions（HTTP 斜杠命令等），由配置项 `connection` 区分。

安装：

```bash
pnpm add @zhin.js/adapter-discord discord.js
```

配置（Gateway，默认）：

```yaml
plugins:
  - "@zhin.js/adapter-discord"

bots:
  - context: discord
    connection: gateway
    name: discord-bot
    token: "${DISCORD_TOKEN}"
```

Interactions 模式需启用 `@zhin.js/http`，并配置 `connection: interactions`、`applicationId`、`publicKey`、`interactionsPath`，详见 [@zhin.js/adapter-discord](https://github.com/zhinjs/zhin/tree/master/plugins/adapters/discord) README。

### Telegram

安装：

```bash
pnpm add @zhin.js/adapter-telegram
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-telegram"

bots:
  - context: telegram
    name: telegram-bot
    token: "${TELEGRAM_TOKEN}"
```

### Slack

安装：

```bash
pnpm add @zhin.js/adapter-slack
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-slack"

bots:
  - context: slack
    name: slack-bot
    token: "${SLACK_TOKEN}"
```

### 钉钉

安装：

```bash
pnpm add @zhin.js/adapter-dingtalk
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-dingtalk"

bots:
  - context: dingtalk
    name: dingtalk-bot
    appKey: "${DINGTALK_APP_KEY}"
    appSecret: "${DINGTALK_APP_SECRET}"
```

### 飞书

安装：

```bash
pnpm add @zhin.js/adapter-lark
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-lark"

bots:
  - context: lark
    name: lark-bot
    appId: "${LARK_APP_ID}"
    appSecret: "${LARK_APP_SECRET}"
```

### OneBot v11

[OneBot 11](https://github.com/botuniverse/onebot) 协议适配器，**一个适配器**支持正向 WebSocket 与反向 WebSocket，由配置项 `connection` 区分。

安装：

```bash
pnpm add @zhin.js/adapter-onebot11 ws
```

反向 WS 需同时启用 `@zhin.js/http`。

配置（正向 WS）：

```yaml
plugins:
  - "@zhin.js/adapter-onebot11"

bots:
  - context: onebot11
    connection: ws
    name: onebot-bot
    url: "ws://127.0.0.1:6700"
    access_token: "${ONEBOT11_ACCESS_TOKEN}"
```

反向 WS：`connection: wss`，并配置 `path`，详见 [@zhin.js/adapter-onebot11](https://github.com/zhinjs/zhin/tree/master/plugins/adapters/onebot11) README。

### Milky

[Milky](https://milky.ntqqrev.org/) 协议适配器，**一个适配器**支持四种连接方式（WebSocket 正向/反向、SSE、Webhook），由配置项 `connection` 区分；支持 HTTP API 与 `access_token` 鉴权。

安装：

```bash
pnpm add @zhin.js/adapter-milky ws eventsource
```

需同时启用 `@zhin.js/http`（适配器依赖 router 注册）。

配置示例（WebSocket 正向）：

```yaml
plugins:
  - "@zhin.js/http"
  - "@zhin.js/adapter-milky"

bots:
  - context: milky
    connection: ws
    name: milky-bot
    baseUrl: "http://127.0.0.1:8080"
    access_token: "${MILKY_ACCESS_TOKEN}"
```

其他连接方式：`connection: sse`（SSE）、`connection: webhook`（Webhook）、`connection: wss`（反向 WS），详见 [@zhin.js/adapter-milky](https://github.com/zhinjs/zhin/tree/master/plugins/adapters/milky) README。

### Satori

[Satori](https://satori.chat/zh-CN/introduction.html) 通用聊天协议适配器，**一个适配器**支持 WebSocket 正向与 Webhook，由配置项 `connection` 区分；支持 HTTP API 与 Bearer Token 鉴权。

安装：

```bash
pnpm add @zhin.js/adapter-satori ws
```

Webhook 方式需同时启用 `@zhin.js/http`。

配置示例（WebSocket 正向）：

```yaml
plugins:
  - "@zhin.js/adapter-satori"

bots:
  - context: satori
    connection: ws
    name: satori-bot
    baseUrl: "http://127.0.0.1:5140"
    token: "${SATORI_TOKEN}"
```

其他连接方式：`connection: webhook`（Webhook），详见 [@zhin.js/adapter-satori](https://github.com/zhinjs/zhin/tree/master/plugins/adapters/satori) README。

### OneBot 12

[OneBot 12](https://12.onebot.dev/) 标准适配器，**一个适配器**支持正向 WebSocket、HTTP Webhook、反向 WebSocket，由配置项 `connection` 区分。

安装：

```bash
pnpm add @zhin.js/adapter-onebot12 ws
```

Webhook / 反向 WS 需同时启用 `@zhin.js/http`。

配置示例（正向 WebSocket）：

```yaml
plugins:
  - "@zhin.js/adapter-onebot12"

bots:
  - context: onebot12
    connection: ws
    name: ob12-bot
    url: "ws://127.0.0.1:6700"
    access_token: "${ONEBOT12_ACCESS_TOKEN}"
```

其他连接方式：`connection: webhook`（Webhook，可选 `api_url` 用于发消息）、`connection: wss`（反向 WS），详见 [@zhin.js/adapter-onebot12](https://github.com/zhinjs/zhin/tree/master/plugins/adapters/onebot12) README。

### 微信公众号

安装：

```bash
pnpm add @zhin.js/adapter-wechat-mp
```

### 邮件

安装：

```bash
pnpm add @zhin.js/adapter-email
```

## 多平台同时运行

```yaml
plugins:
  - "@zhin.js/adapter-icqq"
  - "@zhin.js/adapter-kook"
  - "@zhin.js/adapter-discord"

bots:
  - context: icqq
    name: "${ICQQ_ACCOUNT}"
    password: "${ICQQ_PASSWORD}"
    platform: 5
    scope: icqqjs
  
  - context: kook
    name: kook-bot
    token: "${KOOK_TOKEN}"
  
  - context: discord
    name: discord-bot
    token: "${DISCORD_TOKEN}"
```

所有平台共享同一套插件和命令，消息处理逻辑完全统一。

## 适配器工具与技能

适配器不仅负责消息收发，还可以向 AI Agent 提供平台特有的工具。

### 群管理能力（自动检测）

群管理是 IM 系统的通用能力。Adapter 基类声明了 `IGroupManagement` 接口中的可选方法规范，适配器只需覆写自己平台支持的方法，`start()` 会自动检测并生成 Tool + 注册 Skill，无需任何手动调用：

```typescript
class IcqqAdapter extends Adapter<IcqqBot> {
  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId)
    return bot!.kickMember(Number(sceneId), Number(userId), false)
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId)
    return bot!.muteMember(Number(sceneId), Number(userId), duration)
  }

  async start() {
    this.registerPlatformTools() // 仅注册平台特有工具
    await super.start()          // 自动检测群管方法 → 生成 Tool → 注册 Skill
  }
}
```

目前 10 余个 IM 适配器（ICQQ、OneBot11、Milky、QQ 官方、Telegram、Discord、KOOK、Slack、钉钉、飞书等）以及 Satori、OneBot 12 等协议适配器均已接入，详见下方 [可用适配器一览](#可用适配器一览)。

### 平台特有工具（addTool）

对于标准群管以外的平台特有操作（如 ICQQ 的头衔、群公告、戳一戳，Discord 的角色管理等），仍通过 `addTool()` 手动注册，它们会被自动收录到同一个 Skill 中：

```typescript
private registerPlatformTools() {
  this.addTool({
    name: 'icqq_set_title',
    description: '设置群成员的专属头衔',
    parameters: { /* JSON Schema */ },
    permissionLevel: 'group_owner',
    execute: async (args) => { /* ... */ },
  })
}
```

详见 [工具与技能](/advanced/tools-skills)。

## 可用适配器一览

| 平台 | 包名 | 说明 |
|------|------|------|
| ICQQ (QQ) | `@zhin.js/adapter-icqq` | QQ 非官方协议，功能最全 |
| QQ 官方 | `@zhin.js/adapter-qq` | QQ 官方机器人 API |
| KOOK | `@zhin.js/adapter-kook` | KOOK（开黑啦）|
| Discord | `@zhin.js/adapter-discord` | Discord（单适配器，connection: gateway/interactions） |
| Telegram | `@zhin.js/adapter-telegram` | Telegram |
| Slack | `@zhin.js/adapter-slack` | Slack |
| 钉钉 | `@zhin.js/adapter-dingtalk` | 钉钉 |
| 飞书 | `@zhin.js/adapter-lark` | 飞书 / Lark |
| OneBot v11 | `@zhin.js/adapter-onebot11` | OneBot v11 协议（单适配器，connection: ws/wss） |
| Milky | `@zhin.js/adapter-milky` | Milky 协议（单适配器，connection: ws/sse/webhook/wss） |
| Satori | `@zhin.js/adapter-satori` | Satori 协议（单适配器，connection: ws/webhook） |
| OneBot 12 | `@zhin.js/adapter-onebot12` | OneBot 12 标准（单适配器，connection: ws/webhook/wss） |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | 微信公众号 |
| Sandbox | `@zhin.js/adapter-sandbox` | 终端测试 |
| Email | `@zhin.js/adapter-email` | 邮件 |
