# @zhin.js/adapter-icqq

Zhin 机器人框架的 ICQQ 适配器，用于连接 QQ 机器人。

## 特性

- 📱 **QQ 协议** - 基于 @icqqjs/icqq 实现
- 📨 **完整消息支持** - 文本、表情、图片、语音、视频、文件等
- 🔐 **多种登录方式** - 密码登录、扫码登录、短信验证
- 💬 **群聊和私聊** - 支持群组和私聊消息
- 🎨 **富文本消息** - At、回复、JSON 卡片、Markdown 等
- 🔄 **自动重连** - 网络断开自动重连
- 📊 **Web 管理** - 集成 Web 管理界面

## 安装

```bash
pnpm add @zhin.js/adapter-icqq
```

## 使用

### 配置

在 `zhin.config.ts` 中配置：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: '123456789',  // QQ 号
      context: 'icqq',
      
      // 登录密码（可选，不提供则扫码登录）
      password: 'your_password',
      
      // 数据目录（可选）
      data_dir: './data',
      
      // 作用域（可选）
      scope: 'icqqjs',
      
      // 其他 ICQQ 配置...
      platform: 2,        // 1:安卓手机 2:aPad 3:安卓手表 4:MacOS 5:iPad
      log_level: 'info',
    }
  ],
  plugins: [
    'adapter-icqq',
    'http',        // 可选：Web 管理界面需要
    'console'      // 可选：Web 管理界面需要
  ]
})
```

## Bot 配置

### IcqqBotConfig

```typescript
interface IcqqBotConfig extends BotConfig, Config {
  context: 'icqq'
  name: `${number}`        // QQ 号（字符串格式）
  password?: string        // 登录密码
  scope?: string           // 作用域（默认：icqqjs）
  data_dir?: string        // 数据目录
  
  // ICQQ 配置
  platform?: 1 | 2 | 3 | 4 | 5
  log_level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'off'
  ignore_self?: boolean
  resend?: boolean
  reconn_interval?: number
  internal_cache_life?: number
  auto_server?: boolean
  // ...更多 ICQQ 配置
}
```

## 登录方式

### 1. 密码登录

```typescript
{
  name: '123456789',
  context: 'icqq',
  password: 'your_password',
  platform: 2  // aPad 平台
}
```

### 2. 扫码登录

不提供密码时自动使用扫码登录：

```typescript
{
  name: '123456789',
  context: 'icqq',
  // 不提供 password
}
```

控制台会显示二维码链接，扫码后按回车继续。

### 3. 短信验证

需要短信验证时，控制台会提示输入验证码。

### 4. 滑块验证

需要滑块验证时，控制台会显示验证链接，完成后输入 ticket。

## 消息格式

### 接收的消息

```typescript
{
  $id: string                    // 消息 ID
  $adapter: 'icqq'
  $bot: string                   // QQ 号
  $sender: {
    id: string                   // 发送者 QQ 号
    name: string                 // 发送者昵称
  },
  $channel: {
    id: string                   // 群号或 QQ 号
    type: 'private' | 'group'
  },
  $content: MessageElement[]     // 消息段数组
  $timestamp: number             // 时间戳
  $raw: string                   // 原始消息文本
}
```

### 支持的消息段

```typescript
// 文本
{ type: 'text', data: { text: string } }

// 表情
{ type: 'face', data: { id: string } }

// 图片
{ type: 'image', data: { file: string, url?: string } }

// 语音
{ type: 'record', data: { file: string } }

// 音频
{ type: 'audio', data: { file: string } }

// 视频
{ type: 'video', data: { file: string } }

// 文件
{ type: 'file', data: { file: string } }

// At
{ type: 'at', data: { qq: string } }

// 回复
{ type: 'reply', data: { id: string } }

// 位置
{ type: 'location', data: { lat: number, lng: number, address: string } }

// 分享
{ type: 'share', data: { url: string, title: string, content?: string, image?: string } }

// JSON 卡片
{ type: 'json', data: { data: string } }

// Markdown
{ type: 'markdown', data: { content: string } }

// 按钮
{ type: 'button', data: { /* ... */ } }

// 骰子
{ type: 'dice', data: {} }

// 猜拳
{ type: 'rps', data: {} }
```

## API 使用

### 监听消息

```typescript
import { onMessage, onGroupMessage, onPrivateMessage } from 'zhin.js'

// 所有消息
onMessage(async (message) => {
  if (message.$adapter === 'icqq') {
    console.log('QQ 消息:', message.$content)
  }
})

// 群消息
onGroupMessage(async (message) => {
  if (message.$adapter === 'icqq') {
    console.log('群消息:', message.$raw)
  }
})

// 私聊消息
onPrivateMessage(async (message) => {
  if (message.$adapter === 'icqq') {
    console.log('私聊消息:', message.$raw)
  }
})
```

### 发送消息

```typescript
import { segment } from 'zhin.js'

// 文本消息
await message.$reply('Hello, QQ!')

// At 某人
await message.$reply([
  { type: 'at', data: { qq: '123456789' } },
  segment.text(' 你好！')
])

// 发送图片
await message.$reply([
  segment.text('这是一张图片：'),
  { type: 'image', data: { file: 'https://example.com/image.jpg' } }
])

// 引用回复
await message.$reply('这是回复', true)

// 发送语音
await message.$reply([
  { type: 'record', data: { file: './audio.silk' } }
])

// 发送视频
await message.$reply([
  { type: 'video', data: { file: './video.mp4' } }
])
```

### 撤回消息

```typescript
const messageId = await message.$reply('这条消息会被撤回')

// 撤回消息
await bot.$recallMessage(messageId)
```

## 完整示例

### 基础机器人

```typescript
import { createApp, onMessage, onGroupMessage, MessageCommand, addCommand } from 'zhin.js'

const app = await createApp({
  bots: [
    {
      name: '123456789',
      context: 'icqq',
      platform: 2
    }
  ]
})

// 监听群消息
onGroupMessage(async (message) => {
  if (message.$adapter === 'icqq') {
    console.log(`群 ${message.$channel.id} 消息:`, message.$raw)
  }
})

// 添加命令
addCommand(new MessageCommand('hello')
  .scope('icqq')
  .action(async (message) => {
    return [
      { type: 'at', data: { qq: message.$sender.id } },
      { type: 'text', data: { text: ' 你好！' } }
    ]
  }))

// 图片命令
addCommand(new MessageCommand('pic')
  .scope('icqq')
  .action(async (message) => {
    return [
      { type: 'text', data: { text: '这是一张图片：' } },
      { type: 'image', data: { file: 'https://example.com/image.jpg' } }
    ]
  }))
```

### 高级功能

```typescript
import { useContext } from 'zhin.js'

useContext(['icqq'], (adapter) => {
  for (const [name, bot] of adapter.bots) {
    // 监听好友请求
    bot.on('request.friend.add', async (e) => {
      console.log('好友请求:', e.user_id, e.comment)
      // 自动同意
      await e.approve()
    })
    
    // 监听群邀请
    bot.on('request.group.invite', async (e) => {
      console.log('群邀请:', e.group_id)
      // 自动同意
      await e.approve()
    })
    
    // 监听撤回
    bot.on('notice.group.recall', async (e) => {
      console.log('消息被撤回:', e.message_id)
    })
    
    // 监听群成员变化
    bot.on('notice.group.increase', async (e) => {
      console.log('新成员加入:', e.user_id)
      await bot.sendGroupMsg(e.group_id, `欢迎新成员 @${e.user_id}`)
    })
  }
})
```

## Web 管理界面

ICQQ 适配器包含一个 Web 管理界面，可以在浏览器中管理 QQ 机器人。

### 启用 Web 管理

确保安装了 HTTP 和 Console 插件：

```typescript
plugins: [
  'http',
  'console',
  'adapter-icqq'
]
```

访问 `http://localhost:8086` 可以看到 ICQQ 管理界面，支持：

- 查看机器人状态
- 查看好友列表和群列表
- 发送测试消息
- 管理登录状态

## 平台选择

不同平台有不同的特性和限制：

| 平台 | 值 | 说明 |
|------|-----|------|
| Android Phone | 1 | 安卓手机 |
| aPad | 2 | 安卓平板（推荐） |
| Android Watch | 3 | 安卓手表 |
| MacOS | 4 | MacOS |
| iPad | 5 | iPad |

推荐使用 aPad (平台 2)，稳定性较好。

## 注意事项

### 1. 登录安全

- 首次登录可能需要短信验证或滑块验证
- 频繁登录可能触发风控
- 建议使用固定 IP 和设备信息

### 2. 消息限制

- 群消息发送频率有限制
- 大文件传输可能失败
- 图片需要使用正确的格式

### 3. 数据目录

`data_dir` 用于存储设备信息和会话数据，不要删除。

### 4. 风控

- 避免频繁发送消息
- 避免发送敏感内容
- 遵守 QQ 用户协议

## 故障排除

### 登录失败

1. 检查 QQ 号和密码是否正确
2. 尝试使用扫码登录
3. 检查网络连接
4. 查看控制台错误信息

### 收不到消息

1. 检查 Intents 配置
2. 确认机器人在群内
3. 检查是否被风控

### 发送失败

1. 检查消息格式
2. 检查是否有发送权限
3. 检查是否被限流

## 相关资源

- [ICQQ 文档](https://github.com/icqqjs/icqq)
- [Zhin 完整文档](https://docs.zhin.dev)
- [适配器开发](https://docs.zhin.dev/adapter/getting-started)

## 许可证

MIT License
