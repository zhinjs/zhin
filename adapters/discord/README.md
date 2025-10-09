# @zhin.js/adapter-discord

Zhin.js Discord 适配器，基于 `discord.js` v14 实现，支持 **Gateway** 和 **Interactions** 两种模式。

## 安装

```bash
pnpm add @zhin.js/adapter-discord
```

## 配置

### Gateway 模式配置（推荐常规使用）

```typescript
import { DiscordBotConfig } from '@zhin.js/adapter-discord';

const config: DiscordBotConfig = {
  context: 'discord',
  name: 'my-discord-bot',
  token: 'YOUR_BOT_TOKEN', // 从 Discord Developer Portal 获取的 Bot Token
}
```

### Interactions 端点模式配置（推荐高性能场景）

```typescript
import { DiscordInteractionsConfig } from '@zhin.js/adapter-discord';

const config: DiscordInteractionsConfig = {
  context: 'discord-interactions',
  name: 'my-discord-bot',
  token: 'YOUR_BOT_TOKEN',
  applicationId: 'YOUR_APPLICATION_ID', // Discord 应用 ID
  publicKey: 'YOUR_PUBLIC_KEY', // Discord 应用的 Public Key
  interactionsPath: '/discord/interactions', // 交互端点路径
  useGateway: false // 是否同时使用 Gateway（可选）
}
```

### 通用配置参数

- `token` (必需): Discord Bot Token，从 [Discord Developer Portal](https://discord.com/developers/applications) 获取
- `name`: 机器人名称
- `intents`: Gateway Intents 配置（可选，有默认值）
- `enableSlashCommands`: 是否启用斜杠命令支持（默认: false）
- `globalCommands`: 是否注册全局命令（默认: false，全局命令更新较慢）
- `slashCommands`: Slash Commands 定义数组（使用 SlashCommandBuilder 创建）
- `defaultActivity`: 默认活动状态配置（可选）
  - `name`: 活动名称
  - `type`: 活动类型（'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING'）
  - `url`: 活动URL（流媒体类型需要）

### 完整配置示例

#### Gateway 模式完整配置

```typescript
import { GatewayIntentBits, SlashCommandBuilder } from 'discord.js';

const config: DiscordBotConfig = {
  context: 'discord',
  name: 'my-discord-bot',
  token: 'YOUR_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  enableSlashCommands: true,
  globalCommands: false,
  defaultActivity: {
    name: '正在为用户服务',
    type: 'PLAYING'
  },
  slashCommands: [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('显示帮助信息')
      .toJSON()
  ]
}
```

#### Interactions 模式完整配置

```typescript
import { SlashCommandBuilder } from 'discord.js';

const config: DiscordInteractionsConfig = {
  context: 'discord-interactions',
  name: 'interactions-bot',
  token: 'YOUR_BOT_TOKEN',
  applicationId: 'YOUR_APPLICATION_ID',
  publicKey: 'YOUR_PUBLIC_KEY',
  interactionsPath: '/discord/interactions',
  useGateway: false, // 纯 Interactions 模式
  slashCommands: [
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('测试命令')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('weather')
      .setDescription('获取天气信息')
      .addStringOption(option =>
        option.setName('city')
          .setDescription('城市名称')
          .setRequired(true)
      )
      .toJSON()
  ],
  globalCommands: true // Interactions 模式推荐使用全局命令
}
```

## 获取配置信息

### 获取 Bot Token

1. 访问 [Discord Developer Portal](https://discord.com/developers/applications)
2. 创建新的应用程序（New Application）
3. 在左侧菜单选择 "Bot"
4. 点击 "Reset Token" 获取新的 Token
5. 复制 Token（注意保密）
6. 在 "Privileged Gateway Intents" 中启用需要的权限

### 获取 Application ID 和 Public Key（Interactions 模式需要）

1. 在 Discord Developer Portal 的应用详情页
2. **Application ID**: 在 "General Information" 页面可以找到
3. **Public Key**: 在 "General Information" 页面的 "Public Key" 字段

## 使用示例

### Gateway 模式使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-discord';

const app = createApp();

app.adapter('discord', {
  context: 'discord',
  name: 'my-bot',
  token: 'YOUR_BOT_TOKEN'
});

app.middleware((session, next) => {
  console.log(`收到消息: ${session.content}`);
  return next();
});

app.command('ping').action((session) => {
  session.send('Pong! 🏓');
});

app.start();
```

### Interactions 端点模式使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-discord';
import '@zhin.js/http'; // 需要 HTTP 插件支持

const app = createApp();

// 先加载 HTTP 插件
app.plugin(require('@zhin.js/http'));

// 配置 Discord Interactions
app.adapter('discord-interactions', {
  context: 'discord-interactions',
  name: 'interactions-bot',
  token: 'YOUR_BOT_TOKEN',
  applicationId: 'YOUR_APPLICATION_ID',
  publicKey: 'YOUR_PUBLIC_KEY',
  interactionsPath: '/discord/interactions'
});

// 处理 Slash Commands
app.command('ping').action((session) => {
  session.send('Pong from Interactions! ⚡');
});

app.start();
```

### 高级功能使用

```typescript
import { createApp } from 'zhin.js';
import '@zhin.js/adapter-discord';

const app = createApp();

app.adapter('discord', {
  context: 'discord',
  name: 'advanced-bot',
  token: 'YOUR_BOT_TOKEN',
  defaultActivity: {
    name: '正在处理消息',
    type: 'LISTENING'
  }
});

// 处理提及消息
app.middleware((session, next) => {
  const mentions = session.content.filter(seg => seg.type === 'at');
  if (mentions.length > 0) {
    console.log('收到提及:', mentions.map(seg => seg.data.name));
  }
  return next();
});

// 发送富媒体消息
app.command('embed').action(async (session) => {
  await session.send([
    {
      type: 'embed',
      data: {
        title: '这是一个 Embed 消息',
        description: '支持丰富的格式化内容',
        color: 0x00ff00,
        fields: [
          { name: '字段1', value: '值1', inline: true },
          { name: '字段2', value: '值2', inline: true }
        ],
        thumbnail: { url: 'https://example.com/thumbnail.png' },
        footer: { text: '底部文字' },
        timestamp: new Date().toISOString()
      }
    }
  ]);
});

// 处理图片消息
app.middleware((session, next) => {
  const imageSegments = session.content.filter(seg => seg.type === 'image');
  if (imageSegments.length > 0) {
    console.log('收到图片:', imageSegments.map(seg => seg.data.url));
  }
  return next();
});

app.start();
```

## 两种模式对比

| 特性 | Gateway 模式 | Interactions 端点模式 |
|------|-------------|---------------------|
| **连接方式** | WebSocket 长连接 | HTTP 端点接收 |
| **实时性** | 高（实时推送） | 高（实时推送） |
| **消息处理** | 全部消息类型 | 主要是 Slash Commands |
| **资源消耗** | 中等（保持连接） | 低（按需处理） |
| **网络要求** | 稳定网络连接 | 需要公网 HTTPS |
| **适用场景** | 全功能机器人 | 命令型机器人 |
| **响应速度** | 一般 | 极快 |
| **配置复杂度** | 简单 | 中等 |

### 选择建议

- **全功能机器人**: 使用 `discord` (Gateway 模式)
- **命令型机器人**: 使用 `discord-interactions` (Interactions 模式)
- **高性能场景**: 优先考虑 Interactions 模式
- **开发阶段**: Gateway 模式更方便调试

## 支持的消息类型

### 接收消息 (Gateway 模式)
- **文本消息**: 支持 Discord 格式化语法（**粗体**、*斜体*、`代码`等）
- **用户提及**: 解析 @用户 提及，包含用户 ID 和显示名
- **频道提及**: 解析 #频道 提及，包含频道信息
- **角色提及**: 解析 @角色 提及，包含角色信息
- **自定义表情**: 解析服务器自定义表情
- **图片消息**: 支持图片附件和 URL
- **音频消息**: 支持音频文件附件
- **视频消息**: 支持视频文件附件
- **文件消息**: 支持任意格式的文件附件
- **Embed 消息**: 支持富文本嵌入消息
- **回复消息**: 支持消息回复和引用

### 接收消息 (Interactions 模式)
- **Slash Commands**: 接收并解析 Discord 斜杠命令
- **命令参数**: 自动解析命令的各种参数类型
- **上下文信息**: 包含用户、频道、服务器等上下文信息

### 发送消息 (两种模式)
- **文本消息**: 支持 Discord 格式化语法
- **用户提及**: 发送 @用户 提及
- **频道提及**: 发送 #频道 提及  
- **角色提及**: 发送 @角色 提及
- **自定义表情**: 发送服务器自定义表情
- **图片消息**: 发送图片文件、URL或Buffer
- **音频消息**: 发送音频文件
- **视频消息**: 发送视频文件
- **文件消息**: 发送任意格式的文件
- **Embed 消息**: 发送富文本嵌入消息
- **回复消息**: 回复到指定消息

## 聊天类型支持

- `private`: 私信（DM）
- `group`: 群组私信（Group DM）
- `channel`: 服务器频道（Guild Text Channel）

## Discord 特色功能

### Slash Commands

#### Gateway 模式中的 Slash Commands

```typescript
import { SlashCommandBuilder } from 'discord.js';

// 定义 Slash Commands
const slashCommands = [
  new SlashCommandBuilder()
    .setName('weather')
    .setDescription('获取天气信息')
    .addStringOption(option =>
      option.setName('city')
        .setDescription('城市名称')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('detailed')
        .setDescription('是否显示详细信息')
        .setRequired(false)
    )
    .toJSON()
];

// 配置 Bot
const bot = app.adapter('discord', {
  // ... 其他配置
  enableSlashCommands: true,
  slashCommands
});

// 添加处理器
bot.addSlashCommandHandler('weather', async (interaction) => {
  const city = interaction.options.getString('city');
  const detailed = interaction.options.getBoolean('detailed') || false;
  
  // 处理命令逻辑
  await interaction.reply(`${city} 的天气信息...`);
});
```

#### Interactions 模式中的 Slash Commands

```typescript
// Interactions 模式自动处理 Slash Commands
app.command('weather <city:string> [detailed:boolean]').action((session) => {
  const city = session.argv.city;
  const detailed = session.argv.detailed || false;
  
  session.send(`${city} 的天气信息...`);
});
```

### Embed 消息

Discord 的嵌入消息支持丰富的格式化内容：

```typescript
app.command('rich').action(async (session) => {
  await session.send([
    {
      type: 'embed',
      data: {
        title: '丰富的嵌入消息',
        description: '这是一个包含多种元素的 Embed',
        url: 'https://example.com',
        color: 0x00ff00, // 绿色
        
        // 作者信息
        author: {
          name: '作者名称',
          icon_url: 'https://example.com/author.png',
          url: 'https://example.com/author'
        },
        
        // 缩略图
        thumbnail: {
          url: 'https://example.com/thumb.png'
        },
        
        // 字段
        fields: [
          {
            name: '字段1',
            value: '这是第一个字段的内容',
            inline: true
          },
          {
            name: '字段2', 
            value: '这是第二个字段的内容',
            inline: true
          },
          {
            name: '完整宽度字段',
            value: '这个字段占据完整宽度',
            inline: false
          }
        ],
        
        // 图片
        image: {
          url: 'https://example.com/image.png'
        },
        
        // 底部信息
        footer: {
          text: '底部文字',
          icon_url: 'https://example.com/footer.png'
        },
        
        // 时间戳
        timestamp: new Date().toISOString()
      }
    }
  ]);
});
```

### 权限管理

Discord 机器人需要适当的权限才能正常工作：

```typescript
// 常用权限示例
const requiredPermissions = [
  'VIEW_CHANNEL',      // 查看频道
  'SEND_MESSAGES',     // 发送消息
  'READ_MESSAGE_HISTORY', // 读取消息历史
  'USE_SLASH_COMMANDS', // 使用斜杠命令
  'EMBED_LINKS',       // 嵌入链接
  'ATTACH_FILES',      // 附加文件
  'ADD_REACTIONS',     // 添加反应
  'MENTION_EVERYONE'   // 提及所有人（谨慎使用）
];
```

## 最佳实践

### 1. Intent 选择

只启用需要的 Intent 以提高性能和安全性：

```typescript
import { GatewayIntentBits } from 'discord.js';

// 最小权限集合
const minimalIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages
];

// 需要读取消息内容时
const messageContentIntents = [
  ...minimalIntents,
  GatewayIntentBits.MessageContent
];

// 需要成员信息时
const memberIntents = [
  ...messageContentIntents,
  GatewayIntentBits.GuildMembers
];
```

### 2. 错误处理

```typescript
app.adapter('discord', {
  // ... 配置
}).on('error', (error) => {
  console.error('Discord adapter error:', error);
});

// 优雅处理 API 限制
app.middleware(async (session, next) => {
  try {
    await next();
  } catch (error) {
    if (error.code === 50013) { // Missing Permissions
      await session.send('抱歉，我没有执行此操作的权限。');
    } else {
      console.error('Command error:', error);
    }
  }
});
```

### 3. 性能优化

```typescript
// 使用 Interactions 模式处理命令
app.adapter('discord-interactions', {
  // 只注册需要的 Slash Commands
  slashCommands: [
    // 只包含实际使用的命令
  ],
  // 全局命令响应更快
  globalCommands: true
});

// Gateway 模式优化
app.adapter('discord', {
  // 只启用必要的 Intent
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});
```

## 故障排除

### Gateway 模式问题

1. **连接失败**
   ```
   Error: Cannot connect to gateway
   ```
   - 检查网络连接和防火墙设置
   - 确认 Token 是否正确且有效
   - 检查 Intent 权限是否足够

2. **权限不足**
   ```
   DiscordAPIError: Missing Permissions
   ```
   - 在 Discord 服务器中检查机器人权限
   - 确认机器人已被正确邀请到服务器
   - 检查频道特定权限

### Interactions 模式问题

1. **端点验证失败**
   ```
   Invalid Discord signature
   ```
   - 确认 `publicKey` 配置正确
   - 检查 Discord 应用设置中的 Public Key
   - 确保使用 HTTPS 且证书有效

2. **命令注册失败**
   ```
   Error registering slash commands
   ```
   - 检查 `applicationId` 是否正确
   - 确认 Bot Token 权限足够
   - 验证命令定义格式是否正确

3. **端点无响应**
   ```
   Interaction endpoint not responding
   ```
   - 确保 `interactionsPath` 路径正确
   - 检查 HTTP 插件是否已加载
   - 确认防火墙和反向代理配置

### 通用问题

1. **Token 无效**
   - 重新生成 Bot Token
   - 确认复制时没有额外空格
   - 检查 Token 格式是否完整

2. **消息发送失败**
   - 检查机器人是否在目标频道中
   - 确认消息内容符合 Discord 限制
   - 验证权限设置

## 更新日志

### v1.1.0
- ✨ 新增 Interactions 端点模式支持
- ✨ 使用 `useContext('router')` 集成 HTTP 服务
- 🔒 添加签名验证安全机制
- ⚡ 优化 Slash Commands 处理性能
- 📚 完善两种模式的文档说明

### v1.0.0
- 🎉 初始版本
- 🌐 完整的 Gateway 模式支持
- 🎯 丰富的消息类型支持
- ⚡ Slash Commands 集成
- 📱 Embed 消息和多媒体支持
- 🔧 灵活的权限和活动配置