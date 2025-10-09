# @zhin.js/adapter-telegram

Zhin.js Telegram 适配器，基于 `node-telegram-bot-api` 实现，支持 **Polling** 和 **Webhook** 两种模式。

## 安装

```bash
pnpm add @zhin.js/adapter-telegram
```

## 配置

### Polling 模式配置（推荐开发使用）

```typescript
import { TelegramBotConfig } from '@zhin.js/adapter-telegram';

const config: TelegramBotConfig = {
  context: 'telegram',
  name: 'my-telegram-bot',
  token: 'YOUR_BOT_TOKEN', // 从 @BotFather 获取的 Bot Token
  mode: 'polling' // 可选，默认就是 polling
}
```

### Webhook 模式配置（推荐生产使用）

```typescript
import { TelegramWebhookConfig } from '@zhin.js/adapter-telegram';

const config: TelegramWebhookConfig = {
  context: 'telegram-webhook',
  name: 'my-telegram-bot',
  token: 'YOUR_BOT_TOKEN',
  mode: 'webhook',
  webhookPath: '/telegram/webhook', // 内部路由路径
  webhookUrl: 'https://yourdomain.com/telegram/webhook', // 外部访问 URL
  secretToken: 'your-secret-token' // 可选的安全令牌
}
```

### 通用配置参数

- `token` (必需): Telegram Bot Token，从 [@BotFather](https://t.me/BotFather) 获取
- `name`: 机器人名称
- `proxy`: 代理配置（可选）
  - `host`: 代理服务器地址
  - `port`: 代理服务器端口
  - `username`: 代理用户名（可选）
  - `password`: 代理密码（可选）
- `fileDownload`: 文件下载配置（可选）
  - `enabled`: 是否启用自动文件下载（默认: false）
  - `downloadPath`: 文件下载路径（默认: './downloads'）
  - `maxFileSize`: 最大文件大小，单位字节（默认: 20MB）

### 代理和文件下载配置示例

```typescript
const config: TelegramBotConfig = {
  context: 'telegram',
  name: 'my-telegram-bot',
  token: 'YOUR_BOT_TOKEN',
  proxy: {
    host: '127.0.0.1',
    port: 1080,
    username: 'user',
    password: 'pass'
  },
  fileDownload: {
    enabled: true,
    downloadPath: './telegram_files',
    maxFileSize: 50 * 1024 * 1024 // 50MB
  }
}
```

## 获取 Bot Token

1. 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新机器人
3. 按照提示设置机器人名称和用户名
4. 获得 Bot Token，格式类似：`123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ`

## 使用示例

### Polling 模式使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-telegram';

const app = createApp();

app.adapter('telegram', {
  context: 'telegram',
  name: 'my-bot',
  token: 'YOUR_BOT_TOKEN'
});

app.middleware((session, next) => {
  
  return next();
});

app.command('ping').action((session) => {
  session.send('pong!');
});

app.start();
```

### Webhook 模式使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-telegram';
import '@zhin.js/http'; // 需要 HTTP 插件支持

const app = createApp();

// 先加载 HTTP 插件
app.plugin(require('@zhin.js/http'));

// 配置 Telegram Webhook
app.adapter('telegram-webhook', {
  context: 'telegram-webhook',
  name: 'webhook-bot',
  token: 'YOUR_BOT_TOKEN',
  mode: 'webhook',
  webhookPath: '/telegram/webhook',
  webhookUrl: 'https://your-domain.com/telegram/webhook',
  secretToken: 'your-secret-token'
});

app.command('start').action((session) => {
  session.send('欢迎使用 Telegram Bot（Webhook 模式）！');
});

app.start();
```

### 高级功能使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-telegram';

const app = createApp();

app.adapter('telegram', {
  context: 'telegram',
  name: 'advanced-bot',
  token: 'YOUR_BOT_TOKEN',
  fileDownload: {
    enabled: true,
    downloadPath: './downloads'
  }
});

// 处理图片消息
app.middleware((session, next) => {
  const imageSegments = session.content.filter(seg => seg.type === 'image');
  if (imageSegments.length > 0) {
    console.log('收到图片消息:', imageSegments.map(seg => seg.data.file_id));
  }
  return next();
});

// 发送多媒体消息
app.command('send-image').action(async (session) => {
  await session.send([
    { type: 'image', data: { url: 'https://example.com/image.jpg' } },
    { type: 'text', data: { text: '这是一张图片' } }
  ]);
});

// 回复消息
app.command('echo').action(async (session) => {
  await session.$reply('你说: ' + session.content.find(s => s.type === 'text')?.data.text);
});

app.start();
```

## 两种模式对比

| 特性 | Polling 模式 | Webhook 模式 |
|------|-------------|-------------|
| **网络要求** | 机器人主动拉取 | 需要公网 HTTPS |
| **实时性** | 较低（轮询间隔） | 高（实时推送） |
| **服务器要求** | 低（无需公网IP） | 高（需要域名+SSL） |
| **适用场景** | 开发、测试、小规模 | 生产、大规模 |
| **资源消耗** | 中等（持续轮询） | 低（按需处理） |
| **配置复杂度** | 简单 | 中等 |

### 选择建议

- **开发阶段**: 使用 `telegram` (Polling 模式)
- **生产部署**: 使用 `telegram-webhook` (Webhook 模式)

## 支持的消息类型

### 接收消息
- **文本消息**: 支持文本格式化（粗体、斜体、代码等）
- **图片消息**: 支持所有格式的图片和图片说明
- **音频消息**: 支持音频文件，包含元数据（时长、表演者、标题等）
- **语音消息**: 支持语音消息，包含时长和编码信息
- **视频消息**: 支持视频文件和视频说明
- **视频笔记**: 支持圆形视频消息
- **文档消息**: 支持文档文件和文档说明
- **贴纸消息**: 支持静态和动态贴纸
- **位置消息**: 支持地理位置信息
- **联系人消息**: 支持联系人信息
- **回复消息**: 支持嵌套回复消息
- **提及消息**: 支持 @用户名 和用户ID提及
- **链接消息**: 自动解析URL和文本链接
- **标签消息**: 支持 #标签 识别

### 发送消息
- **文本消息**: 支持HTML格式化
- **图片消息**: 支持发送图片文件、URL或file_id
- **音频消息**: 支持发送音频文件，可设置元数据
- **语音消息**: 支持发送语音文件
- **视频消息**: 支持发送视频文件，可设置尺寸等属性
- **视频笔记**: 支持发送圆形视频
- **文档消息**: 支持发送任意格式的文件
- **贴纸消息**: 支持发送贴纸（仅限file_id）
- **位置消息**: 支持发送地理位置
- **联系人消息**: 支持发送联系人信息
- **回复消息**: 支持回复指定消息

## 聊天类型支持

- `private`: 私聊
- `group`: 群组
- `supergroup`: 超级群组
- `channel`: 频道

## 特性说明

### Webhook 模式安全性
- **签名验证**: 使用 `secretToken` 验证请求来源
- **HTTPS 要求**: Telegram 要求 Webhook URL 必须是 HTTPS
- **路径隔离**: 支持自定义路径，避免与其他服务冲突

### 文件下载
- 默认情况下，文件下载功能是关闭的，只提供文件的 `file_id`
- 启用文件下载后，适配器会自动在后台下载消息中的文件到本地
- 支持的文件类型：图片、音频、语音、视频、文档、贴纸等
- 下载操作是异步的，不会阻塞消息处理流程

### 消息格式化
- 支持 Telegram 的所有消息实体（粗体、斜体、代码、链接等）
- 自动解析 @提及 和 #标签
- 支持嵌套回复消息的完整解析
- 保留原始消息的所有元数据

### 消息发送
- 支持发送多种格式的多媒体内容
- 自动根据内容类型选择合适的 Telegram API
- 支持批量发送多个消息段
- 智能处理回复消息

## 注意事项

1. **网络连接**: 如果在中国大陆使用，可能需要配置代理才能正常连接到 Telegram API
2. **安全性**: Bot Token 需要保密，不要在代码中硬编码或提交到版本控制系统
3. **环境变量**: 建议使用环境变量存储敏感信息
4. **文件大小限制**: Telegram Bot API 对文件大小有限制，建议设置合理的 `maxFileSize`
5. **频率限制**: 注意 Telegram 的频率限制，避免发送消息过于频繁
6. **Webhook 要求**: Webhook 模式需要：
   - 有效的 HTTPS 域名
   - SSL 证书
   - 能够接收 Telegram 服务器的 POST 请求
   - zhin.js 的 `@zhin.js/http` 插件支持

## 故障排除

### Webhook 模式问题

1. **Webhook 设置失败**
   ```
   Error: HTTPS URL must be provided for webhook
   ```
   - 确保 `webhookUrl` 使用 HTTPS 协议
   - 检查域名和 SSL 证书是否有效

2. **签名验证失败**
   ```
   Invalid Discord signature
   ```
   - 检查 `secretToken` 配置是否正确
   - 确认 Telegram 发送的请求头包含正确的签名

3. **路径冲突**
   ```
   路由已存在
   ```
   - 确保 `webhookPath` 在应用中是唯一的
   - 避免与其他插件或适配器的路径冲突

### Polling 模式问题

1. **代理连接失败**
   - 检查代理服务器配置
   - 确认防火墙设置
   - 尝试不同的代理协议（SOCKS5）

2. **Token 无效**
   - 重新从 @BotFather 获取 Token
   - 检查 Token 格式是否正确

## 更新日志

### v1.1.0
- ✨ 新增 Webhook 模式支持
- ✨ 使用 `useContext('router')` 集成 HTTP 服务
- 🔒 添加签名验证安全机制
- 📚 完善文档和示例

### v1.0.0
- 🎉 初始版本
- 🔄 Polling 模式支持
- 🎯 完整的多媒体消息支持
- 🌐 代理支持
- 📁 文件下载功能