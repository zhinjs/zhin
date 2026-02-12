# @zhin.js/adapter-lark

Zhin.js 飞书 / Lark 适配器，支持飞书机器人的消息收发和群管理。

## 功能特性

- 支持飞书和 Lark 国际版
- Webhook 事件接收（HTTP 回调）
- Bearer Token 自动刷新
- 消息加密和签名验证（可选）
- URL 验证自动处理
- 群管理 AI 工具（通过 declareSkill 暴露给 AI）

## 安装

```bash
pnpm add @zhin.js/adapter-lark
```

## 依赖

- `@zhin.js/http` — HTTP 服务（提供 Webhook 路由）

## 配置

```yaml
# zhin.config.yml
bots:
  - context: lark
    name: my-lark-bot
    appId: cli_xxxxxxxxxxxx
    appSecret: xxxxxxxxxxxxxxxxxxxxxxxx
    webhookPath: /lark/webhook
    # 可选配置
    # encryptKey: your-encrypt-key
    # verificationToken: your-token
    # isFeishu: true          # 使用飞书 API（默认）
    # apiBaseUrl: https://open.feishu.cn/open-apis   # 自定义 API 地址

plugins:
  - adapter-lark
  - http
```

或使用 TypeScript 配置：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'lark',
      name: 'my-lark-bot',
      appId: process.env.LARK_APP_ID!,
      appSecret: process.env.LARK_APP_SECRET!,
      webhookPath: '/lark/webhook',
    }
  ],
  plugins: ['adapter-lark', 'http']
})
```

## 使用示例

### 注册命令

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello')
    .desc('飞书问候')
    .action((message) => {
      return `你好，${message.$sender.name}！`
    })
)
```

### 消息处理

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware } = usePlugin()

addMiddleware(async (message, next) => {
  if (message.$adapter === 'lark') {
    console.log('收到飞书消息:', message.$content)
  }
  await next()
})
```

## AI 工具（Skill）

适配器内置群管理 Skill，自动注册以下工具供 AI 调用：

- 群聊管理（成员管理、群信息修改等）

> 工具使用飞书的 `open_id` 和 `chat_id` 格式标识用户和群聊。

## 飞书开发者配置

1. 登录 [飞书开放平台](https://open.feishu.cn/)
2. 创建应用并获取 `App ID` 和 `App Secret`
3. 配置事件回调 URL：`http://your-server:8086/api/lark/webhook`
4. 订阅 `im.message.receive_v1` 事件
5. 发布应用

## 许可证

MIT License
