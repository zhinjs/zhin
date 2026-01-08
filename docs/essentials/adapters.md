# 适配器

适配器用于连接不同的聊天平台。

## 内置适配器

### Sandbox（本地测试）

```yaml
plugins:
  - "@zhin.js/adapter-sandbox"
```

在终端中直接输入消息测试。

## 平台适配器

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
    appid: YOUR_APPID
    secret: YOUR_SECRET
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
    token: YOUR_TOKEN
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
    token: YOUR_TOKEN
```

## 多平台同时运行

```yaml
plugins:
  - "@zhin.js/adapter-qq"
  - "@zhin.js/adapter-kook"
  - "@zhin.js/adapter-discord"

bots:
  - context: qq
    name: qq-bot
    appid: YOUR_APPID
    secret: YOUR_SECRET
  
  - context: kook
    name: kook-bot
    token: YOUR_KOOK_TOKEN
  
  - context: discord
    name: discord-bot
    token: YOUR_DISCORD_TOKEN
```

## 可用适配器

| 平台 | 包名 | 状态 |
|------|------|------|
| QQ | `@zhin.js/adapter-qq` | ✅ |
| KOOK | `@zhin.js/adapter-kook` | ✅ |
| Discord | `@zhin.js/adapter-discord` | ✅ |
| Telegram | `@zhin.js/adapter-telegram` | ✅ |
| Slack | `@zhin.js/adapter-slack` | ✅ |
| 钉钉 | `@zhin.js/adapter-dingtalk` | ✅ |
| 飞书 | `@zhin.js/adapter-lark` | ✅ |
| OneBot v11 | `@zhin.js/adapter-onebot11` | ✅ |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | ✅ |

