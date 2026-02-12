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

ICQQ 适配器提供丰富的群管理工具（踢人、禁言、设管理员、改名片等），详见 [工具与技能](/advanced/tools-skills)。

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

安装：

```bash
pnpm add @zhin.js/adapter-discord
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-discord"

bots:
  - context: discord
    name: discord-bot
    token: "${DISCORD_TOKEN}"
```

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

安装：

```bash
pnpm add @zhin.js/adapter-onebot11
```

配置：

```yaml
plugins:
  - "@zhin.js/adapter-onebot11"

bots:
  - context: onebot11
    name: onebot-bot
    url: "ws://127.0.0.1:6700"
```

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

### 工具注册（addTool）

每个适配器通过 `addTool()` 注册平台特有的操作，如群管理、成员管理等：

```typescript
class MyAdapter extends Adapter<MyBot> {
  async start() {
    this.addTool({
      name: 'my_kick_member',
      description: '踢出群成员',
      parameters: { /* JSON Schema */ },
      permissionLevel: 'group_admin',
      execute: async (args, context) => { /* ... */ },
    })
    await super.start()
  }
}
```

### 技能声明（declareSkill）

适配器可以通过 `declareSkill()` 将所有工具聚合为一个语义化的 Skill，帮助 AI 更好地理解平台能力和调用约定：

```typescript
async start() {
  this.registerMyTools()
  this.declareSkill({
    description: 'QQ群管理能力，包括踢人、禁言、设管理员等',
    keywords: ['QQ', '群管理'],
    tags: ['qq', '社交平台'],
    conventions: '用户和群均使用数字 QQ号标识。bot 参数填 Bot ID，group_id 填场景 ID。',
  })
  await super.start()
}
```

`conventions` 字段描述平台特有的调用约定，AI 在选中该 Skill 时会看到这些信息。

详见 [工具与技能](/advanced/tools-skills)。

## 可用适配器一览

| 平台 | 包名 | 说明 |
|------|------|------|
| ICQQ (QQ) | `@zhin.js/adapter-icqq` | QQ 非官方协议，功能最全 |
| QQ 官方 | `@zhin.js/adapter-qq` | QQ 官方机器人 API |
| KOOK | `@zhin.js/adapter-kook` | KOOK（开黑啦）|
| Discord | `@zhin.js/adapter-discord` | Discord |
| Telegram | `@zhin.js/adapter-telegram` | Telegram |
| Slack | `@zhin.js/adapter-slack` | Slack |
| 钉钉 | `@zhin.js/adapter-dingtalk` | 钉钉 |
| 飞书 | `@zhin.js/adapter-lark` | 飞书 / Lark |
| OneBot v11 | `@zhin.js/adapter-onebot11` | OneBot v11 协议 |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | 微信公众号 |
| Sandbox | `@zhin.js/adapter-sandbox` | 终端测试 |
| Email | `@zhin.js/adapter-email` | 邮件 |
