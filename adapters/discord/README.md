# @zhin.js/adapter-discord

Zhin 机器人框架的 Discord 适配器，支持 Discord Gateway 和 Interactions 两种模式。

## 特性

- 🌐 **双模式支持** - Gateway 模式和 Interactions 端点模式
- 📨 **完整消息支持** - 文本、图片、音视频、嵌入、贴纸等
- ⚡ **Slash Commands** - 支持斜杠命令
- 🎯 **消息解析** - 自动解析 @提及、频道引用、角色、表情
- 🔒 **签名验证** - Interactions 模式的签名验证
- 🎨 **富文本** - 支持 Embed、附件等富文本消息
- 📊 **活动状态** - 设置机器人活动状态

## 安装

```bash
pnpm add @zhin.js/adapter-discord
```

## 使用

### 模式一：Gateway 模式

标准的 Discord Gateway 连接方式。

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'discord-bot',
      context: 'discord',
      token: process.env.DISCORD_TOKEN,
      
      // 可选配置
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      
      // 启用 Slash Commands
      enableSlashCommands: true,
      globalCommands: true,
      
      // 活动状态
      defaultActivity: {
        name: 'Playing Zhin.js',
        type: 'PLAYING',
      },
      
      // Slash Commands 定义
      slashCommands: [
        {
          name: 'hello',
          description: 'Say hello',
          options: []
        }
      ]
    }
  ],
  plugins: ['adapter-discord']
})
```

### 模式二：Interactions 端点模式

使用 HTTP 端点接收 Discord Interactions（需要 @zhin.js/http）。

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'discord-interactions',
      context: 'discord-interactions',
      token: process.env.DISCORD_TOKEN,
      applicationId: process.env.DISCORD_APP_ID,
      publicKey: process.env.DISCORD_PUBLIC_KEY,
      
      // Interactions 端点路径
      interactionsPath: '/discord/interactions',
      
      // 可选：同时使用 Gateway
      useGateway: false,
      
      // Slash Commands
      slashCommands: [
        {
          name: 'ping',
          description: 'Ping pong',
        }
      ],
      globalCommands: true
    }
  ],
  plugins: [
    'http',                    // 必需
    'adapter-discord'
  ]
})
```

## Bot 配置

### DiscordBotConfig (Gateway)

```typescript
interface DiscordBotConfig extends BotConfig {
  context: 'discord'
  token: string
  name: string
  
  // Discord Gateway Intents
  intents?: GatewayIntentBits[]
  
  // Slash Commands 配置
  enableSlashCommands?: boolean
  globalCommands?: boolean
  slashCommands?: ApplicationCommandData[]
  
  // 活动状态
  defaultActivity?: {
    name: string
    type: 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING'
    url?: string
  }
}
```

### DiscordInteractionsConfig (Interactions)

```typescript
interface DiscordInteractionsConfig extends BotConfig {
  context: 'discord-interactions'
  token: string
  name: string
  applicationId: string
  publicKey: string
  interactionsPath: string
  
  // 可选：同时使用 Gateway
  useGateway?: boolean
  intents?: GatewayIntentBits[]
  
  // Slash Commands
  slashCommands?: ApplicationCommandData[]
  globalCommands?: boolean
  defaultActivity?: {
    name: string
    type: 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING'
    url?: string
  }
}
```

## 消息格式

### 接收的消息

```typescript
{
  $id: string                    // 消息 ID
  $adapter: 'discord'
  $bot: string
  $sender: {
    id: string                   // 用户 ID
    name: string                 // 显示名称
  },
  $channel: {
    id: string                   // 频道 ID
    type: 'private' | 'group' | 'channel'
  },
  $content: MessageElement[]     // 消息段数组
  $timestamp: number
  $raw: string                   // 原始消息文本
}
```

### 消息段类型

```typescript
// 文本
{ type: 'text', data: { text: string } }

// @用户
{ type: 'at', data: { id: string, name: string, text: string } }

// 频道引用
{ type: 'channel_mention', data: { id: string, name: string, text: string } }

// 角色引用
{ type: 'role_mention', data: { id: string, name: string, text: string } }

// 表情
{ type: 'emoji', data: { id: string, name: string, animated: boolean, url: string, text: string } }

// 图片
{ type: 'image', data: { id: string, name: string, url: string, proxy_url: string, size: number, width: number, height: number, content_type: string } }

// 音频
{ type: 'audio', data: { id: string, name: string, url: string, proxy_url: string, size: number, content_type: string } }

// 视频
{ type: 'video', data: { id: string, name: string, url: string, proxy_url: string, size: number, width: number, height: number, content_type: string } }

// 文件
{ type: 'file', data: { id: string, name: string, url: string, proxy_url: string, size: number, content_type: string } }

// 嵌入消息
{ type: 'embed', data: { title?: string, description?: string, color?: number, url?: string, thumbnail?: object, image?: object, author?: object, footer?: object, fields?: array, timestamp?: string } }

// 贴纸
{ type: 'sticker', data: { id: string, name: string, url: string, format: number, tags?: string } }

// 引用回复
{ type: 'reply', data: { id: string, channel_id?: string, guild_id?: string } }
```

## API 使用

### 监听消息

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  if (message.$adapter === 'discord') {
    console.log('Discord 消息:', message.$content)
    await message.$reply('Hello from Discord!')
  }
})
```

### 发送富文本消息

```typescript
import { segment } from 'zhin.js'

await message.$reply([
  segment.text('Hello '),
  { type: 'at', data: { id: message.$sender.id } },
  segment.text('!'),
  { type: 'image', data: { url: 'https://example.com/image.jpg' } },
  { 
    type: 'embed', 
    data: {
      title: 'Embed Title',
      description: 'Embed Description',
      color: 0x00ff00,
      fields: [
        { name: 'Field 1', value: 'Value 1', inline: true }
      ]
    }
  }
])
```

### 注册 Slash Command 处理器

```typescript
import { useContext } from 'zhin.js'

useContext(['discord'], (adapter) => {
  for (const bot of adapter.bots.values()) {
    // 添加 slash command 处理器
    bot.addSlashCommandHandler('hello', async (interaction) => {
      await interaction.reply('Hello, World!')
    })
    
    bot.addSlashCommandHandler('ping', async (interaction) => {
      await interaction.reply({
        content: 'Pong!',
        ephemeral: true  // 只有用户可见
      })
    })
  }
})
```

## Slash Commands

### 定义 Slash Commands

```typescript
slashCommands: [
  {
    name: 'hello',
    description: 'Say hello',
  },
  {
    name: 'greet',
    description: 'Greet someone',
    options: [
      {
        name: 'user',
        description: 'User to greet',
        type: 6,  // USER type
        required: true
      },
      {
        name: 'message',
        description: 'Greeting message',
        type: 3,  // STRING type
        required: false
      }
    ]
  }
]
```

### 处理 Slash Commands

```typescript
bot.addSlashCommandHandler('greet', async (interaction) => {
  const user = interaction.options.getUser('user')
  const message = interaction.options.getString('message') || 'Hello'
  
  await interaction.reply(`${message}, <@${user.id}>!`)
})
```

## 完整示例

### Gateway 模式示例

```typescript
import { createApp, onMessage, MessageCommand, addCommand } from 'zhin.js'

const app = await createApp({
  bots: [
    {
      name: 'discord-bot',
      context: 'discord',
      token: process.env.DISCORD_TOKEN,
      enableSlashCommands: true,
      slashCommands: [
        {
          name: 'echo',
          description: 'Echo a message',
          options: [
            {
              name: 'text',
              description: 'Text to echo',
              type: 3,
              required: true
            }
          ]
        }
      ]
    }
  ]
})

// 监听消息
onMessage(async (message) => {
  if (message.$adapter === 'discord') {
    console.log('收到消息:', message.$raw)
  }
})

// 添加命令
addCommand(new MessageCommand('hello')
  .scope('discord')
  .action(async (message) => {
    return 'Hello from Zhin.js!'
  }))
```

## 注意事项

### Gateway Intents

Discord 需要正确的 Intents 才能接收消息：

```typescript
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,    // 需要特权
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMembers,      // 需要特权
  GatewayIntentBits.GuildMessageReactions
]
```

特权 Intents 需要在 Discord Developer Portal 中启用。

### Interactions 端点

使用 Interactions 模式时，需要在 Discord Developer Portal 中设置 Interactions Endpoint URL：

```
https://your-domain.com/discord/interactions
```

### 消息限制

- Discord 消息最多 2000 字符
- Embed 最多 10 个
- 文件最多 10 个（免费用户 8MB，Nitro 用户 100MB）

## 相关资源

- [Discord.js 文档](https://discord.js.org/)
- [Discord API 文档](https://discord.com/developers/docs)
- [Zhin 完整文档](https://docs.zhin.dev)

## 许可证

MIT License
