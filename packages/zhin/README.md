# zhin.js - 开箱即用的机器人框架

🚀 **一个包，全功能** - 安装 `zhin.js` 即可获得完整的机器人开发体验。

## ✨ 特性

- 📦 **开箱即用** - 包含进程适配器、HTTP服务、Web控制台和SQLite数据库
- 🔌 **插件化架构** - 需要更多功能时可安装对应的适配器和数据库驱动
- ⚡ **热重载** - 开发时修改代码立即生效
- 🌐 **Web控制台** - 浏览器中管理和监控机器人
- 🗄️ **数据库支持** - 默认SQLite，可扩展MySQL/PostgreSQL

## 🚀 快速开始

### 安装

```bash
npm install zhin.js
# 或
pnpm add zhin.js
```

### 创建应用

```typescript
import { createZhinApp } from 'zhin.js'

const app = await createZhinApp({
  // 数据库配置
  databases: [{
    name: 'main',
    type: 'sqlite', 
    database: './data/bot.db'
  }],
  // 机器人配置
  bots: [{
    name: 'console',
    context: 'process'  // 控制台机器人，用于测试
  }]
})

// 启动应用
await app.start()
```

### 添加功能

```typescript
import { addCommand, addMiddleware, onMessage } from 'zhin.js'

// 添加命令
addCommand({
  name: 'hello',
  description: '打招呼',
  async execute(message) {
    await message.reply('Hello, World!')
  }
})

// 添加中间件
addMiddleware(async (message, next) => {
  console.log('收到消息:', message.content)
  await next()
})

// 监听消息
onMessage(async (message) => {
  if (message.content === 'ping') {
    await message.reply('pong!')
  }
})
```

## 📦 包含的功能

| 功能 | 描述 |
|------|------|
| **@zhin.js/adapter-process** | 控制台适配器，支持命令行交互 |
| **@zhin.js/http** | HTTP服务，提供API接口 |
| **@zhin.js/console** | Web控制台，浏览器管理界面 |

## 🔌 扩展功能

需要连接其他平台或数据库时，安装对应的包：

```bash
# 更多适配器
pnpm add @zhin.js/adapter-telegram  # Telegram机器人
pnpm add @zhin.js/adapter-discord   # Discord机器人
pnpm add @zhin.js/adapter-qq        # QQ机器人

```

然后在代码中引入即可自动注册：

```typescript
import '@zhin.js/adapter-telegram'
import '@zhin.js/database-mysql'

const app = await createZhinApp({
  databases: [{
    name: 'main',
    type: 'mysql',
    host: 'localhost',
    username: 'root',
    password: 'password',
    database: 'bot_db'
  }],
  bots: [{
    name: 'telegram_bot',
    context: 'telegram',
    token: 'YOUR_BOT_TOKEN'
  }]
})
```

## 🌐 Web控制台

启动应用后，访问 http://localhost:8086 即可打开Web控制台：

- 📊 **实时监控** - 查看机器人状态和消息统计
- 🔧 **插件管理** - 启用/禁用插件功能
- 📋 **数据库管理** - 查看和操作数据库
- 📝 **日志查看** - 实时查看系统日志

## 📚 更多文档

- [完整文档](../../docs/)
- [最佳实践](../../docs/guide/best-practices.md)
- [架构设计](../../docs/guide/architecture.md)

## 📄 许可证

MIT License