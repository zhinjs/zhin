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

## 前置条件

| 要求 | 说明 |
|------|------|
| **公众号** | 已注册微信公众号，并在 [微信公众平台](https://mp.weixin.qq.com/) 获取 `AppID`、`AppSecret` |
| **服务器配置** | 配置 Token（与 `token` 字段一致）；服务器 URL 须公网可访问 |
| **host-router** | **必需** — 适配器在 `path` 上注册 GET/POST Webhook 路由 |
| **响应时限** | 微信要求 **5 秒内**响应；超时会导致接入失败 |
| **回复模式** | 默认 `replyMode: passive`（订阅号被动回复，在 webhook 响应里返回 XML）；服务号可设 `customer_service` 走客服 API |
| **消息加密** | 可选；`encrypt: true` + `encodingAESKey`；`encryptMode: compatible`（默认，被动回复明文）或 `secure`（被动回复也加密） |

必填字段见 `WeChatMPConfig`：`context`、`name`、`appId`、`appSecret`、`token`、`path`。

## 最小配置

```yaml
plugins:
  - "@zhin.js/adapter-wechat-mp"
  - "@zhin.js/host-router"

endpoints:
  - context: wechat-mp
    name: my-wechat-bot
    appId: "${WECHAT_APP_ID}"
    appSecret: "${WECHAT_APP_SECRET}"
    token: "${WECHAT_TOKEN}"
    path: /wechat/webhook
```

## 依赖

- `@zhin.js/host-router` — HTTP 服务（提供 Webhook 路由）

## 配置

### TypeScript 配置

完整选项示例（含可选加密字段）：

```yaml
endpoints:
  - context: wechat-mp
    name: my-wechat-bot
    appId: ${WECHAT_APP_ID}
    appSecret: ${WECHAT_APP_SECRET}
    token: ${WECHAT_TOKEN}
    path: /wechat/webhook
    # encodingAESKey: your-aes-key
    # encrypt: false
```

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  endpoints: [
    {
      context: 'wechat-mp',
      name: 'my-wechat-bot',
      appId: process.env.WECHAT_APP_ID!,
      appSecret: process.env.WECHAT_APP_SECRET!,
      token: process.env.WECHAT_TOKEN!,
      path: '/wechat/webhook',
    }
  ],
  plugins: ['@zhin.js/adapter-wechat-mp', '@zhin.js/host-router']
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
3. 配置服务器地址（URL）：`https://your-server/wechat/webhook`（无 `/api` 前缀；经反向代理时自行映射）
4. 设置 Token（与配置文件中的 `token` 一致）
5. 如需消息加解密，设置 EncodingAESKey

## 故障排查

| 现象 | 排查 |
|------|------|
| 服务器配置验证失败 | `token` 与公众平台一致；URL 为 `https://<host>/wechat/webhook`；Host 已启动且公网可达 |
| 收不到用户消息 | 公众号类型是否支持消息接口；用户是否已关注；`path` 与公众平台 URL 一致 |
| 回复超时 / 无回复 | 默认被动回复须在 **~4.5s** 内完成；AI 过慢会返回 `success` 无正文，可改 `replyMode: customer_service`（需客服接口权限） |
| `48001 api unauthorized` | 未认证订阅号无客服 API；保持默认 `replyMode: passive` |
| 加密模式报错 | `encodingAESKey`、`encrypt` 与公众平台「安全模式」设置一致 |

## 文档链接

- [微信公众号适配器文档](https://zhin.js.org/adapters/wechat-mp)
- [适配器概览](https://zhin.js.org/essentials/adapters)
- [微信公众平台](https://mp.weixin.qq.com/)

## 许可证

MIT License
