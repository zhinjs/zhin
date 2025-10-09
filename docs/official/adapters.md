# 🔌 官方适配器

Zhin 提供了多个官方适配器，支持不同的聊天平台和协议，让你的机器人能够轻松接入各种服务。

## 📱 适配器概览

| 适配器 | 包名 | 支持平台 | 状态 | 特性 |
|--------|------|----------|------|------|
| **Process** | `@zhin.js/adapter-process` | 控制台 | ✅ 稳定 | 开发调试、本地测试 |
| **ICQQ** | `@zhin.js/adapter-icqq` | QQ | ✅ 稳定 | 群聊、私聊、媒体消息 |
| **KOOK** | `@zhin.js/adapter-kook` | KOOK | ✅ 稳定 | 语音频道、文字频道 |
| **OneBot v11** | `@zhin.js/adapter-onebot11` | 通用协议 | ✅ 稳定 | 跨平台兼容 |

## 🖥️ Process 适配器

控制台适配器，用于开发调试和本地测试。

### 安装

```bash
pnpm add @zhin.js/adapter-process
```

### 配置

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'console-bot',
        context: 'process'  // 使用 process 适配器
      }
    ],
    plugins: [
      'adapter-process'  // 启用适配器
    ]
  }
})
```

### 使用方式

启动后直接在终端输入消息与机器人交互：

```bash
$ pnpm dev
✅ 机器人启动成功！
控制台机器人已就绪，可以直接输入消息

hello
👋 你好！我是 Zhin 机器人

ping
🏓 Pong! 机器人运行正常
```

### 特性

- ✅ **零配置** - 无需额外设置
- 🔄 **实时交互** - 直接在终端输入消息
- 🐛 **调试友好** - 适合开发和测试
- 📝 **日志清晰** - 所有操作都有详细输出

## 🐧 ICQQ 适配器

基于 ICQQ 的 QQ 机器人适配器，支持完整的 QQ 功能。

### 安装

```bash
pnpm add @zhin.js/adapter-icqq
```

### 配置（基于实际代码）

```javascript
// zhin.config.ts - 基于 test-bot 实际配置
export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: env.ICQQ_SCAN_UIN,          // QQ号作为机器人名称
        context: 'icqq',
        log_level: 'off',                 // 日志级别
        platform: 4,                     // 登录设备类型
        scope: 'icqqjs',                  // 作用域（可选）
        data_dir: './data'                // 数据目录（默认）
      },
      // 密码登录示例（注释掉的配置）
      // {
      //   name: env.ICQQ_LOGIN_UIN,
      //   context: 'icqq',
      //   log_level: 'off',
      //   password: "your_password",
      //   sign_api_addr: env.ICQQ_SIGN_ADDR,
      //   platform: 2
      // }
    ],
    plugins: [
      'adapter-icqq'  // 启用适配器
    ]
  }
})
```

### 环境变量

```bash
# .env
ICQQ_SCAN_UIN=1234567890      # 扫码登录的QQ号
ICQQ_LOGIN_UIN=1234567890     # 密码登录的QQ号（可选）
ICQQ_SIGN_ADDR=               # 签名服务地址（可选）
```

### 登录方式

#### 1. 扫码登录（推荐）

```javascript
{
  name: env.ICQQ_SCAN_UIN,
  context: 'icqq',
  log_level: 'off',
  platform: 4  // 扫码登录设备类型
}
```

#### 2. 密码登录

```javascript
{
  name: env.ICQQ_LOGIN_UIN,
  context: 'icqq',
  log_level: 'off',
  password: "your_password",
  sign_api_addr: env.ICQQ_SIGN_ADDR,  // 可能需要签名服务
  platform: 2  // 密码登录设备类型
}
```

### 支持的消息类型（基于实际API）

```typescript
import { onMessage, segment } from 'zhin.js'

onMessage(async (message) => {
  // 文本消息
  if (message.raw === 'hello') {
    // 实际的 reply 方法签名：reply(content: SendContent, quote?: boolean|string)
    await message.reply('你好！', false)
  }
  
  // 图片消息
  if (message.content.some(seg => seg.type === 'image')) {
    await message.reply([
      segment('text', { text: '收到图片：' }),
      segment('image', { url: 'https://example.com/image.jpg' })
    ])
  }
  
  // @消息  
  if (message.content.some(seg => seg.type === 'at')) {
    await message.reply('有人@我了！')
  }
  
  // 查看消息详细信息
  console.log('适配器:', message.adapter)  // 'icqq'
  console.log('机器人:', message.bot)
  console.log('频道类型:', message.channel.type) // 'group' | 'private'
  console.log('时间戳:', message.timestamp)
})
```

### 特性

- 📱 **完整QQ功能** - 群聊、私聊、媒体消息
- 🖼️ **媒体支持** - 图片、语音、视频、文件
- 👥 **群管理** - 踢人、禁言、设置管理员
- 🏷️ **多种登录** - 密码、二维码、扫码登录
- 🔄 **自动重连** - 网络断开自动重连
- 💾 **数据持久化** - 自动保存登录状态

## 🎮 KOOK 适配器

KOOK（原开黑啦）机器人适配器，支持语音和文字频道。

### 安装

```bash
pnpm add @zhin.js/adapter-kook
```

### 配置（基于实际代码）

```javascript
// zhin.config.ts - 基于 test-bot 实际配置
export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'zhin',                    // 机器人名称
        context: 'kook',
        token: env.KOOK_TOKEN,           // 机器人Token
        mode: 'websocket',               // 连接模式
        logLevel: 'off',                 // 日志级别
        ignore: 'bot',                   // 忽略机器人消息
        data_dir: './data'               // 数据目录（默认）
      }
    ],
    plugins: [
      'adapter-kook'  // 启用适配器
    ]
  }
})
```

### 环境变量

```bash
# .env
KOOK_TOKEN=Bot_your_token_here  # KOOK机器人Token（需要Bot前缀）
```

### 获取 Token

1. 访问 [KOOK 开发者平台](https://developer.kookapp.cn/)
2. 创建应用和机器人
3. 复制机器人 Token

### 连接模式

#### WebSocket 模式（推荐）

```javascript
{
  name: 'kook-bot',
  context: 'kook',
  token: 'your_token',
  mode: 'websocket'  // 实时连接
}
```

#### Webhook 模式

```javascript
{
  name: 'kook-bot',  
  context: 'kook',
  token: 'your_token',
  mode: 'webhook',
  webhook: {
    port: 3000,
    path: '/kook/webhook',
    secret: 'your_webhook_secret'
  }
}
```

### 消息类型支持（基于实际API）

```typescript
import { onMessage, segment } from 'zhin.js'

onMessage(async (message) => {
  // 频道消息（实际的频道类型字段）
  if (message.channel.type === 'channel') {
    await message.reply(`在频道 ${message.channel.id} 收到消息`)
  }
  
  // 私聊消息  
  if (message.channel.type === 'private') {
    await message.reply('收到私聊消息')
  }
  
  // 使用实际的 segment 函数
  await message.reply([
    segment('text', { text: '这是一个消息：' }),
    // KOOK 特定的消息段类型需要根据实际的 KookBot.toSegments 来确定
    segment('image', { url: 'https://example.com/image.jpg' })
  ])
  
  // 查看KOOK特有信息
  console.log('适配器:', message.adapter)  // 'kook' 
  console.log('作者ID:', message.sender.id)
  console.log('作者名称:', message.sender.name)
})
```

### 特性

- 🎤 **语音频道支持** - 语音消息和频道管理
- 💬 **文字频道支持** - 完整的文本消息功能
- 📋 **卡片消息** - 丰富的卡片样式
- 🔔 **消息通知** - 支持各种消息类型
- 🌐 **双连接模式** - WebSocket 和 Webhook
- 🎯 **高性能** - 基于官方 SDK

## 🌐 OneBot v11 适配器

基于 OneBot v11 协议的通用适配器，兼容多个聊天平台。

### 安装

```bash
pnpm add @zhin.js/adapter-onebot11
```

### 配置

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'onebot-bot',
        context: 'onebot11',
        url: env.ONEBOT_WS_URL,         // WebSocket 地址
        access_token: env.ACCESS_TOKEN,  // 访问令牌（可选）
        options: {
          heartbeat_interval: 30000,     // 心跳间隔
          reconnect_interval: 5000       // 重连间隔
        }
      }
    ],
    plugins: [
      'adapter-onebot11'  // 启用适配器
    ]
  }
})
```

### 环境变量

```bash
# .env
ONEBOT_WS_URL=ws://localhost:8080/ws    # OneBot WebSocket 地址
ACCESS_TOKEN=your_access_token          # 访问令牌（可选）
```

### 支持的实现

OneBot v11 适配器兼容以下实现：

- **go-cqhttp** - Go 语言实现
- **Mirai** - Kotlin 语言实现
- **NoneBot** - Python 语言实现
- **其他兼容实现**

### 连接方式

#### 反向WebSocket（推荐）

```javascript
{
  name: 'onebot-bot',
  context: 'onebot11',
  url: 'ws://localhost:8080/ws',
  access_token: 'your_token'
}
```

#### HTTP API

```javascript
{
  name: 'onebot-bot',
  context: 'onebot11', 
  api_url: 'http://localhost:8080',
  access_token: 'your_token'
}
```

### 标准消息格式

```typescript
import { onMessage, segment } from 'zhin.js'

onMessage(async (message) => {
  // OneBot 标准消息段
  await message.reply([
    segment.text('文本消息'),
    segment.image('file:///path/to/image.jpg'),
    segment.at(message.sender.id),
    segment.face(123),  // 表情
    segment.record('file:///path/to/audio.mp3')  // 语音
  ])
})
```

### 特性

- 🔌 **协议标准** - 遵循 OneBot v11 标准协议
- 🌍 **跨平台兼容** - 支持多种平台实现
- 📡 **双向通信** - WebSocket 和 HTTP API
- 🔐 **安全认证** - 支持访问令牌验证
- 🔄 **自动重连** - 连接断开自动重连
- 📋 **完整API** - 支持所有标准API调用

## 🔧 高级配置

### 多适配器混合使用

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    bots: [
      // 开发环境：控制台
      {
        name: 'dev-bot',
        context: 'process'
      },
      
      // 生产环境：QQ
      ...(env.QQ_UIN ? [{
        name: 'qq-bot',
        context: 'icqq',
        uin: parseInt(env.QQ_UIN),
        password: env.QQ_PASSWORD
      }] : []),
      
      // KOOK频道
      ...(env.KOOK_TOKEN ? [{
        name: 'kook-bot',
        context: 'kook',
        token: env.KOOK_TOKEN
      }] : [])
    ],
    plugins: [
      'adapter-process',
      ...(env.QQ_UIN ? ['adapter-icqq'] : []),
      ...(env.KOOK_TOKEN ? ['adapter-kook'] : [])
    ]
  }
})
```

### 适配器特定消息处理

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  // 根据适配器类型处理消息
  switch (message.platform) {
    case 'icqq':
      // QQ 特有功能
      if (message.type === 'group') {
        await message.reply('这是QQ群消息')
      }
      break
      
    case 'kook':
      // KOOK 特有功能
      await message.reply({
        type: 'card',
        content: 'KOOK卡片消息'
      })
      break
      
    case 'onebot11':
      // OneBot 标准处理
      await message.reply('OneBot标准消息')
      break
  }
})
```

## 🐛 故障排除

### 常见问题

#### ICQQ 登录失败

```bash
# 检查QQ号和密码
QQ_UIN=正确的QQ号
QQ_PASSWORD=正确的密码

# 尝试删除设备锁文件
rm -rf data/device.json
```

#### KOOK 连接超时

```bash
# 检查Token是否正确
KOOK_TOKEN=Bot your_actual_token

# 检查网络连接
ping kookapp.cn
```

#### OneBot 无法连接

```bash
# 检查WebSocket地址
ONEBOT_WS_URL=ws://localhost:8080/ws

# 检查OneBot实现是否启动
curl http://localhost:8080/get_status
```

### 调试模式

启用调试模式查看详细日志：

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    debug: true,  // 启用调试日志
    // ... 其他配置
  }
})
```

## 📚 更多资源

- 🏠 [回到首页](../index.md)
- 🚀 [快速开始](../guide/quick-start.md)
- 🧩 [官方插件](./plugins.md)
- 🔧 [自定义适配器开发](../adapter/)
- 💡 [示例代码](../examples/)

---

💡 **提示**: 选择合适的适配器组合，可以让你的机器人同时在多个平台运行，覆盖更广的用户群体！
