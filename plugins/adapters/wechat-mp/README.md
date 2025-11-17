# WeChat Official Account 适配器

基于微信公众号开发者API的 Zhin 机器人适配器，支持接收和发送微信公众号消息。

## 功能特性

- 🔌 **完整协议支持**: 支持微信公众号开发者模式
- 📨 **消息处理**: 支持文本、图片、语音、视频、地理位置等消息类型
- 🎯 **事件处理**: 支持关注、取关、菜单点击等事件
- 🔐 **安全验证**: 完整的签名验证和加密支持
- 🔄 **Token管理**: 自动获取和刷新access_token
- 💬 **双向通信**: 支持被动回复和主动推送
- 🎛️ **多媒体支持**: 支持图片、语音、视频等多媒体消息
- 🌐 **集成化**: 集成 zhin-next HTTP 服务，无需独立服务器

## 安装

```bash
pnpm add @zhin.js/adapter-wechat-mp
```

## 依赖库

本适配器使用以下库：
- `xml2js` - XML解析和生成
- `axios` - HTTP请求
- `crypto` - 签名验证 (Node.js 内置)
- `@zhin.js/http` - HTTP 服务和路由 (peer dependency)

## 前置准备

### 1. 申请微信公众号

1. 前往 [微信公众平台](https://mp.weixin.qq.com/) 注册账号
2. 选择订阅号或服务号（服务号功能更丰富）
3. 完成认证（可选，但认证后功能更多）

### 2. 获取开发者信息

1. 登录微信公众平台
2. 进入「开发」->「基本配置」
3. 获取以下信息：
   - **AppID** (应用ID)
   - **AppSecret** (应用密钥)
   - 设置 **Token** (自定义，用于验证)
   - 设置 **EncodingAESKey** (可选，用于加密)

### 3. 配置服务器

1. 在「基本配置」中设置服务器地址：
   ```
   URL: http://your-domain.com/wechat
   Token: 你设置的token
   ```
2. 选择消息加解密方式（明文模式或安全模式）

## 配置

### 基础配置

```typescript
import { WeChatMPConfig } from '@zhin.js/adapter-wechat-mp'

const wechatConfig: WeChatMPConfig = {
  context: 'wechat-mp',
  name: 'my-wechat-bot',
  appId: 'your-app-id',
  appSecret: 'your-app-secret',
  token: 'your-token',
  path: '/wechat'
}
```

### 完整配置

```typescript
const wechatConfig: WeChatMPConfig = {
  context: 'wechat-mp',
  name: 'advanced-wechat-bot',
  appId: 'wx1234567890abcdef',
  appSecret: 'your-app-secret-key',
  token: 'your-verification-token',
  encodingAESKey: 'your-encoding-aes-key', // 加密模式需要
  encrypt: false, // 是否启用加密模式
  path: '/wechat/webhook' // Webhook路径（在 HTTP 服务上）
}
```

> **注意**: 这个适配器依赖于 `@zhin.js/http` 插件。需要在配置中同时启用 HTTP 插件。

## 使用示例

### 基础使用

```typescript
import { createApp } from 'zhin.js'
import WeChatMPAdapter from '@zhin.js/adapter-wechat-mp'

const app = createApp({
  // 必须启用 HTTP 插件
  plugins: ['@zhin.js/http'],
  adapters: {
    'wechat-mp': {
      context: 'wechat-mp',
      name: 'my-wechat-bot',
      appId: 'your-app-id',
      appSecret: 'your-app-secret',
      token: 'your-token',
      path: '/wechat'
    }
  }
})

// 处理文本消息
app.on('message.receive', (message) => {
  if (message.$adapter === 'wechat-mp') {
    console.log('收到微信消息:', message.$content)
    
    // 自动回复
    message.$reply('感谢您的消息！')
  }
})

// 处理关注事件
app.on('message.receive', (message) => {
  if (message.$adapter === 'wechat-mp' && 
      message.$content.some(seg => seg.type === 'event' && seg.data.event === 'subscribe')) {
    message.$reply('欢迎关注我们的公众号！')
  }
})

app.start()
```

### 发送不同类型的消息

```typescript
// 发送文本消息
await app.sendMessage({
  context: 'wechat-mp',
  bot: 'my-wechat-bot',
  id: 'user-openid',
  type: 'private',
  content: '这是一条文本消息'
})

// 发送图片消息
await app.sendMessage({
  context: 'wechat-mp', 
  bot: 'my-wechat-bot',
  id: 'user-openid',
  type: 'private',
  content: [
    { type: 'image', data: { mediaId: 'uploaded-media-id' } }
  ]
})

// 发送语音消息
await app.sendMessage({
  context: 'wechat-mp',
  bot: 'my-wechat-bot', 
  id: 'user-openid',
  type: 'private',
  content: [
    { type: 'voice', data: { mediaId: 'voice-media-id' } }
  ]
})
```

### 处理不同消息类型

```typescript
app.on('message.receive', (message) => {
  if (message.$adapter !== 'wechat-mp') return;
  
  for (const segment of message.$content) {
    switch (segment.type) {
      case 'text':
        console.log('文本消息:', segment.data.text);
        break;
        
      case 'image':
        console.log('图片消息:', segment.data.url, segment.data.mediaId);
        break;
        
      case 'voice':
        console.log('语音消息:', segment.data.mediaId, segment.data.recognition);
        break;
        
      case 'video':
        console.log('视频消息:', segment.data.mediaId);
        break;
        
      case 'location':
        console.log('位置消息:', segment.data.latitude, segment.data.longitude);
        break;
        
      case 'link':
        console.log('链接消息:', segment.data.title, segment.data.url);
        break;
        
      case 'event':
        console.log('事件:', segment.data.event, segment.data.eventKey);
        break;
    }
  }
})
```

### 使用公众号API

```typescript
import { WeChatMPBot } from '@zhin.js/adapter-wechat-mp'

// 获取bot实例
const bot = app.getContext('wechat-mp')?.['my-wechat-bot'] as WeChatMPBot;

// 获取用户信息
const userInfo = await bot.getUserInfo('user-openid');
console.log('用户信息:', userInfo);

// 上传多媒体文件
const mediaId = await bot.uploadMedia('image', imageBuffer);
console.log('媒体ID:', mediaId);
```

## 支持的消息类型

### 接收消息

| 微信消息类型 | MessageSegment 类型 | 说明 |
|------------|-------------------|------|
| text | `text` | 文本消息 |
| image | `image` | 图片消息 |
| voice | `voice` | 语音消息 |
| video | `video` | 视频消息 |
| shortvideo | `video` | 小视频消息 |
| location | `location` | 地理位置消息 |
| link | `link` | 链接消息 |
| event | `event` | 事件消息 |

### 发送消息

| MessageSegment 类型 | 微信API | 说明 |
|-------------------|---------|------|
| `text` | 客服消息 | 文本消息 |
| `image` | 客服消息 | 图片消息（需要mediaId） |
| `voice` | 客服消息 | 语音消息（需要mediaId） |
| `video` | 客服消息 | 视频消息（需要mediaId） |

### 事件类型

| 事件类型 | 说明 |
|---------|------|
| subscribe | 关注事件 |
| unsubscribe | 取关事件 |
| CLICK | 菜单点击事件 |
| VIEW | 菜单链接事件 |
| LOCATION | 地理位置事件 |

## 频道类型

| 类型 | 说明 | channel_id 格式 |
|------|------|----------------|
| `private` | 用户私聊 | 用户OpenID |

注意：微信公众号只支持 `private` 类型，因为所有消息都是用户与公众号的私聊。

## 开发模式设置

### 1. 本地开发

使用内网穿透工具（如ngrok）：

```bash
# 安装ngrok
npm install -g ngrok

# 启动内网穿透
ngrok http 3000

# 将生成的https地址设置为微信服务器URL
# 例如: https://abc123.ngrok.io/wechat
```

### 2. 服务器部署

```typescript
// 生产环境配置
const wechatConfig = {
  context: 'wechat-mp',
  name: 'production-bot',
  appId: process.env.WECHAT_APP_ID,
  appSecret: process.env.WECHAT_APP_SECRET,
  token: process.env.WECHAT_TOKEN,
  port: process.env.PORT || 80,
  path: '/wechat'
}
```

### 3. 使用Nginx反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location /wechat {
        proxy_pass http://localhost:3000/wechat;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 高级功能

### 1. 自定义菜单

```typescript
// 创建菜单需要通过微信API
const menuData = {
  "button": [
    {
      "type": "click",
      "name": "功能1", 
      "key": "MENU_KEY_1"
    },
    {
      "type": "view",
      "name": "官网",
      "url": "https://your-website.com"
    }
  ]
}
```

### 2. 模板消息

```typescript
// 发送模板消息
const templateMessage = {
  touser: 'user-openid',
  template_id: 'template-id',
  data: {
    first: { value: '标题' },
    keyword1: { value: '内容1' },
    keyword2: { value: '内容2' },
    remark: { value: '备注' }
  }
}
```

### 3. 素材管理

```typescript
// 上传永久素材
const permanentMedia = await bot.uploadPermanentMedia('image', buffer);

// 获取素材列表
const mediaList = await bot.getMediaList('image', 0, 20);
```

## 错误处理

### 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| 40001 | AppSecret错误 | 检查AppSecret配置 |
| 40002 | 不合法的凭证类型 | 检查access_token |
| 40003 | 不合法的OpenID | 检查用户OpenID |
| 40004 | 不合法的媒体文件类型 | 检查上传文件格式 |
| 40013 | 不合法的AppID | 检查AppID配置 |
| 42001 | access_token超时 | 会自动刷新token |

### 调试建议

1. **检查签名验证**：
   ```javascript
   // 验证微信服务器配置时的日志
   console.log('Signature verification:', { signature, timestamp, nonce });
   ```

2. **查看XML消息**：
   ```javascript
   // 打印接收到的原始XML
   console.log('Received XML:', xmlBody);
   ```

3. **监控Token状态**：
   ```javascript
   // 定期检查token有效性
   console.log('Access Token:', this.accessToken);
   console.log('Expires at:', new Date(this.tokenExpireTime));
   ```

## 安全注意事项

1. **保护敏感信息**: 不要在代码中硬编码AppSecret
2. **使用HTTPS**: 生产环境建议使用HTTPS
3. **签名验证**: 始终验证微信请求的签名
4. **加密通信**: 敏感场景可启用消息加密
5. **频率限制**: 注意微信API的调用频率限制

## API限制

1. **消息发送**: 每天主动推送消息有限制
2. **API调用**: 大部分API每分钟调用次数有限制
3. **媒体上传**: 临时素材3天后失效
4. **用户信息**: 只能获取关注用户的信息

## 故障排除

### 1. 服务器验证失败
- 检查Token配置是否正确
- 确认URL可以正常访问
- 检查签名算法实现

### 2. 消息接收异常
- 检查HTTP服务器是否正常启动
- 验证防火墙和端口配置
- 查看微信开发者工具的错误日志

### 3. 消息发送失败
- 检查access_token是否有效
- 确认用户已关注公众号
- 检查消息格式是否正确

### 4. 多媒体消息问题
- 确认文件格式和大小符合要求
- 检查mediaId是否有效
- 验证文件上传是否成功

## 示例项目

完整的使用示例可以在 `example/` 目录中找到。

## API 参考

### WeChatMPBot 类

#### 配置选项

```typescript
interface WeChatMPConfig {
  context: 'wechat-mp'
  name: string
  appId: string
  appSecret: string  
  token: string
  encodingAESKey?: string
  port?: number
  path?: string
  encrypt?: boolean
}
```

#### 主要方法

- `$connect()`: 启动HTTP服务器和Token管理
- `$disconnect()`: 关闭服务器连接
- `$formatMessage(wechatMsg)`: 格式化微信消息
- `$sendMessage(options)`: 发送消息
- `getUserInfo(openid)`: 获取用户信息
- `uploadMedia(type, buffer)`: 上传多媒体文件

#### 事件

- `message.receive`: 接收到微信消息时触发

## 更新日志

### v0.1.0
- 支持基础消息收发
- 实现签名验证和Token管理
- 支持多种消息类型和事件
- 提供完整的API封装
