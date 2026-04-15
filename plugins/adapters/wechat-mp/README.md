# @zhin.js/adapter-wechat-mp

Zhin.js 微信公众号适配器，支持微信公众号的消息收发。

## 功能特性

- Webhook 事件接收（HTTP 回调）
- 签名验证
- Access Token 自动刷新
- XML 消息解析
- 可选消息加密（AES）

## 安装

```bash
pnpm add @zhin.js/adapter-wechat-mp
```

## 依赖

- `@zhin.js/http` — HTTP 服务（提供 Webhook 路由）

## 配置

```yaml
# zhin.config.yml
bots:
  - context: wechat-mp
    name: my-wechat-bot
    appId: ${WECHAT_APP_ID}
    appSecret: ${WECHAT_APP_SECRET}
    token: ${WECHAT_TOKEN}
    path: /wechat/webhook
    # 可选配置
    # encodingAESKey: your-aes-key
    # encrypt: false

plugins:
  - adapter-wechat-mp
  - http
```

### TypeScript 配置

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'wechat-mp',
      name: 'my-wechat-bot',
      appId: process.env.WECHAT_APP_ID!,
      appSecret: process.env.WECHAT_APP_SECRET!,
      token: process.env.WECHAT_TOKEN!,
      path: '/wechat/webhook',
    }
  ],
  plugins: ['adapter-wechat-mp', 'http']
})
```

## 使用示例

### 注册命令

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello')
    .desc('微信问候')
    .action((message) => `你好，${message.$sender.name}！`)
)
```

### 消息中间件

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware } = usePlugin()

addMiddleware(async (message, next) => {
  if (message.$adapter === 'wechat-mp') {
    console.log('收到微信消息:', message.$content)
  }
  await next()
})
```

## 微信公众号配置

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 在「开发 → 基本配置」中获取 `AppID` 和 `AppSecret`
3. 配置服务器地址（URL）：`http://your-server:8086/api/wechat/webhook`
4. 设置 Token（与配置文件中的 `token` 一致）
5. 如需消息加解密，设置 EncodingAESKey

## 注意事项

- 微信公众号要求服务器必须在 5 秒内响应
- 服务器地址必须是公网可访问的 HTTP/HTTPS URL
- 建议使用已备案的域名

## 许可证

MIT License
