
# 🚀 最佳实践指南

本指南基于实际项目经验，为你提供构建高质量 Zhin.js 机器人的实用建议。

> **生态说明**：Zhin.js 开箱即用支持控制台适配器、HTTP 服务、Web 控制台、SQLite 数据库。Telegram、Discord、QQ、KOOK、OneBot v11、MySQL、PostgreSQL 等需手动安装扩展包。建议最佳实践优先兼容主仓库内置服务，跨平台请注明依赖。

## 📁 推荐项目结构

从 `test-bot` 项目学到的最佳项目组织方式：

```
my-zhin-bot/
├── src/
│   ├── index.ts              # 入口文件
│   └── plugins/              # 插件目录
│       ├── basic.ts          # 基础功能插件
│       ├── admin.ts          # 管理功能插件
│       └── fun.ts            # 娱乐功能插件
├── data/                     # 数据存储目录
│   ├── config/               # 配置文件
│   ├── storage/              # 持久化数据
│   └── logs/                 # 日志文件
├── zhin.config.ts           # 核心配置文件
├── package.json             # 项目依赖
├── tsconfig.json           # TypeScript 配置
├── .env.example            # 环境变量模板
├── .gitignore              # Git 忽略文件
└── README.md               # 项目说明
```

## 🎯 入口文件最佳实践

```typescript
// src/index.ts - 简洁的入口文件
import { createApp } from 'zhin.js'

// 创建应用实例，自动加载 zhin.config.ts
const app = await createApp()

// 启动应用
await app.start()

// 优雅关闭处理
process.on('SIGINT', async () => {
  console.log('\n正在关闭机器人...')
  await app.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await app.stop()
  process.exit(0)
})

console.log('✅ 机器人启动成功！')
```

## ⚙️ 配置管理最佳实践

```javascript
// zhin.config.ts - 基于环境的配置
import { defineConfig } from 'zhin.js'

export default defineConfig(async (env) => {
  return {
    // 🤖 机器人配置
    bots: [
      // 开发时使用控制台
      {
        name: `bot-${process.pid}`,
        context: 'process'
      },
      
      // 生产环境添加真实适配器
      ...(env.QQ_UIN ? [{
        name: 'qq-bot',
        context: 'icqq',
        uin: parseInt(env.QQ_UIN),
        password: env.QQ_PASSWORD
      }] : []),
      
      ...(env.KOOK_TOKEN ? [{
        name: 'kook-bot',
        context: 'kook',
        token: env.KOOK_TOKEN
      }] : [])
    ],
    
    // 📂 插件目录
    plugin_dirs: [
      './src/plugins',
      'node_modules',
      'node_modules/@zhin.js'
    ],
    
    // 💡 插件目录说明：
    // - ./src/plugins: 项目自定义插件目录
    // - node_modules: 第三方 npm 插件目录  
    // - node_modules/@zhin.js: Zhin 官方插件目录（推荐）
    
    // 🧩 启用的插件
    plugins: [
      // 核心插件
      'adapter-process',
      'http',
      'console',
      
      // 自定义插件
      'basic',
      'admin',
      'fun',
      
      // 根据环境启用适配器
      ...(env.QQ_UIN ? ['adapter-icqq'] : []),
      ...(env.KOOK_TOKEN ? ['adapter-kook'] : [])
    ],
    
    // 🐛 调试模式
    debug: env.NODE_ENV !== 'production'
  }
})
```

## 🧩 插件开发最佳实践

### 基础插件结构

```typescript
// src/plugins/basic.ts
import { 
  addCommand, 
  MessageCommand, 
  onMessage,
  useLogger 
} from 'zhin.js'

const logger = useLogger()

// 🏓 简单的健康检查命令
addCommand(new MessageCommand('ping')
  .action(async () => {
    return '🏓 Pong! 机器人运行正常'
  })
)

// 🕐 时间查询
addCommand(new MessageCommand('time')
  .action(async () => {
    return `🕐 当前时间: ${new Date().toLocaleString()}`
  })
)

// 📢 回声命令
addCommand(new MessageCommand('echo <text:text>')
  .action(async (message, result) => {
    return `📢 ${result.args.text}`
  })
)

// 👋 自动问候
onMessage(async (message) => {
  if (message.$raw.match(/^(你好|hello|hi)$/i)) {
    await message.$reply('👋 你好！我是 Zhin 机器人，输入 help 查看可用命令')
  }
})

logger.info('基础插件已加载')
```

### 管理插件结构

```typescript
// src/plugins/admin.ts
import { 
  addCommand,
  MessageCommand,
  addMiddleware,
  useLogger,
  onMounted,
  onDispose
} from 'zhin.js'

const logger = useLogger()

// 简单的管理员列表
const admins = new Set(['your-admin-id'])
const bannedUsers = new Set<string>()

// 🛡️ 权限检查中间件
addMiddleware(async (message, next) => {
  // 检查是否被封禁
  if (bannedUsers.has(message.$sender.id)) {
    logger.warn(`封禁用户尝试发言: ${message.$sender.id}`)
    return // 不处理被封禁用户的消息
  }
  
  await next()
})

// 👑 管理员命令 - 封禁用户
addCommand(new MessageCommand('ban <user:text>')
  .action(async (message, result) => {
    if (!admins.has(message.$sender.id)) {
      return '❌ 权限不足'
    }
    
    const userId = result.args.user
    bannedUsers.add(userId)
    
    logger.warn(`管理员 ${message.$sender.id} 封禁了用户 ${userId}`)
    return `🔨 已封禁用户: ${userId}`
  })
)

// 👑 管理员命令 - 解封用户
addCommand(new MessageCommand('unban <user:text>')
  .action(async (message, result) => {
    if (!admins.has(message.$sender.id)) {
      return '❌ 权限不足'
    }
    
    const userId = result.args.user
    if (bannedUsers.delete(userId)) {
      return `✅ 已解封用户: ${userId}`
    } else {
      return `❌ 用户 ${userId} 未被封禁`
    }
  })
)

// 📊 状态查询
addCommand(new MessageCommand('status')
  .action(async (message) => {
    if (!admins.has(message.$sender.id)) {
      return '❌ 权限不足'
    }
    
    const uptime = process.uptime()
    const memory = process.memoryUsage()
    
    return `📊 机器人状态:
⏱️ 运行时间: ${Math.floor(uptime / 60)}分${Math.floor(uptime % 60)}秒
💾 内存使用: ${Math.round(memory.heapUsed / 1024 / 1024)}MB
🚫 封禁用户: ${bannedUsers.size}个`
  })
)

onMounted(() => {
  logger.info('管理插件已挂载')
})

onDispose(() => {
  logger.info('管理插件已卸载')
})

logger.info('管理插件已加载')
```

### 娱乐插件结构

```typescript
// src/plugins/fun.ts
import { 
  addCommand, 
  MessageCommand, 
  useLogger 
} from 'zhin.js'

const logger = useLogger()

// 🎲 掷骰子
addCommand(new MessageCommand('roll [sides:number=6]')
  .action(async (message, result) => {
    const sides = result.args.sides || 6
    const roll = Math.floor(Math.random() * sides) + 1
    return `🎲 你掷出了 ${roll} 点！（${sides}面骰子）`
  })
)

// 🔮 随机选择
addCommand(new MessageCommand('choose <choices:text>')
  .action(async (message, result) => {
    const choices = result.args.choices
      .split(/[,，|｜]/)
      .map(s => s.trim())
      .filter(s => s)
    
    if (choices.length < 2) {
      return '❌ 请提供至少2个选项，用逗号分隔'
    }
    
    const chosen = choices[Math.floor(Math.random() * choices.length)]
    return `🔮 我选择: **${chosen}**`
  })
)

// 🎯 猜数字游戏
const games = new Map<string, { number: number, attempts: number }>()

addCommand(new MessageCommand('guess [number:number]')
  .action(async (message, result) => {
    const userId = message.$sender.id
    
    // 如果没有提供数字，开始新游戏
    if (!result.args.number) {
      const targetNumber = Math.floor(Math.random() * 100) + 1
      games.set(userId, { number: targetNumber, attempts: 0 })
      return '🎯 猜数字游戏开始！我想了一个1-100的数字，你来猜猜看！'
    }
    
    const game = games.get(userId)
    if (!game) {
      return '🎯 请先输入 guess 开始游戏'
    }
    
    const guess = result.args.number
    game.attempts++
    
    if (guess === game.number) {
      games.delete(userId)
      return `🎉 恭喜！你猜对了！数字是 ${game.number}，你用了 ${game.attempts} 次`
    } else if (guess < game.number) {
      return `📈 太小了！这是你的第 ${game.attempts} 次尝试`
    } else {
      return `📉 太大了！这是你的第 ${game.attempts} 次尝试`
    }
  })
)

logger.info('娱乐插件已加载')
```

## 🔐 环境变量管理

```bash
# .env.example
# 基础配置
NODE_ENV=development
DEBUG=true

# 机器人配置
BOT_NAME=MyAwesomeBot

# QQ 机器人 (可选)
QQ_UIN=
QQ_PASSWORD=

# KOOK 机器人 (可选)
KOOK_TOKEN=

# HTTP 服务
HTTP_PORT=3000

# 数据库 (可选)
DATABASE_URL=

# 日志配置
LOG_LEVEL=info
```

## 📝 日志最佳实践

```typescript
// 在插件中使用日志
import { useLogger } from 'zhin.js'

const logger = useLogger()

// 📊 信息日志
logger.info('插件启动', { plugin: 'weather', version: '1.0.0' })

// ⚠️ 警告日志
logger.warn('API 调用缓慢', { duration: 3000, api: 'weather' })

// ❌ 错误日志
logger.error('天气查询失败', { 
  error: error.message,
  city: 'Beijing',
  timestamp: new Date()
})

// 🐛 调试日志
logger.debug('用户命令', {
  command: 'weather',
  user: message.$sender.id,
  args: result.args
})
```

## 🛡️ 错误处理最佳实践

```typescript
// 简单的错误处理包装器
async function safeExecute<T>(
  action: () => Promise<T>,
  errorMessage: string,
  fallback?: T
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    logger.error(errorMessage, error)
    if (fallback !== undefined) {
      return fallback
    }
    throw error
  }
}

// 使用示例
addCommand(new MessageCommand('weather <city:text>')
  .action(async (message, result) => {
    return await safeExecute(
      async () => {
        const weather = await fetchWeather(result.args.city)
        return formatWeatherMessage(weather)
      },
      '天气查询失败',
      '❌ 天气服务暂时不可用，请稍后重试'
    )
  })
)
```

## 🚀 性能优化建议

### 简单缓存实现

```typescript
// 简单的内存缓存
class SimpleCache<T> {
  private cache = new Map<string, { value: T; expires: number }>()
  
  set(key: string, value: T, ttl = 300000): void { // 默认5分钟
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    })
  }
  
  get(key: string): T | null {
    const item = this.cache.get(key)
    if (!item || item.expires < Date.now()) {
      this.cache.delete(key)
      return null
    }
    return item.value
  }
  
  clear(): void {
    this.cache.clear()
  }
}

// 使用缓存
const weatherCache = new SimpleCache<any>()

addCommand(new MessageCommand('weather <city:text>')
  .action(async (message, result) => {
    const city = result.args.city
    const cacheKey = `weather:${city.toLowerCase()}`
    
    // 检查缓存
    let weather = weatherCache.get(cacheKey)
    if (weather) {
      return `🌤️ ${city}天气（缓存）: ${weather.description}`
    }
    
    // 获取新数据
    weather = await fetchWeather(city)
    weatherCache.set(cacheKey, weather)
    
    return `🌤️ ${city}天气: ${weather.description}`
  })
)
```

## 📦 package.json 最佳配置

```json
{
  "name": "my-zhin-bot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "zhin dev",
    "build": "zhin build", 
    "start": "zhin start",
    "stop": "zhin stop",
    "restart": "zhin restart",
    "test": "vitest"
  },
  "dependencies": {
    "zhin.js": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

## 🧪 测试最佳实践

```typescript
// tests/basic.test.ts
import { describe, it, expect } from 'vitest'

describe('基础功能测试', () => {
  it('应该正确响应 ping 命令', () => {
    // 简单的单元测试
    const response = 'Pong! 机器人运行正常'
    expect(response).toContain('Pong')
  })
  
  it('应该正确格式化时间', () => {
    const now = new Date()
    const formatted = now.toLocaleString()
    expect(formatted).toBeTruthy()
  })
})
```

## 🚀 部署最佳实践

### PM2 部署

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'zhin-bot',
    script: './lib/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      DEBUG: 'false'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log'
  }]
}
```

### Docker 部署

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
RUN npm install --production

# 复制源代码
COPY . .

# 构建项目
RUN npm run build

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]
```

## 📊 监控和维护

```typescript
// 简单的健康检查
addCommand(new MessageCommand('health')
  .action(async () => {
    const uptime = process.uptime()
    const memory = process.memoryUsage()
    
    const health = {
      status: 'healthy',
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
      timestamp: new Date().toISOString()
    }
    
    return `🏥 健康状态: ${JSON.stringify(health, null, 2)}`
  })
)
```

## 🎯 核心原则

1. **保持简单** - 从简单开始，逐步增加复杂性
2. **模块化设计** - 将功能拆分为独立的插件
3. **错误处理** - 始终处理可能的错误情况
4. **日志记录** - 记录关键操作和错误
5. **性能考虑** - 合理使用缓存和异步操作
6. **安全意识** - 验证用户输入和权限
7. **可维护性** - 编写清晰的代码和文档

## 📚 参考资源

- 🎯 [test-bot 示例](https://github.com/zhinjs/zhin/tree/main/test-bot) - 完整的项目示例

---

## 🌍 生态系统与扩展

### 📦 开箱即用
- 控制台适配器（@zhin.js/adapter-process，默认内置）
- HTTP 服务（@zhin.js/http）
- Web 控制台（@zhin.js/console）
- SQLite 数据库（默认）

### 🔌 可选扩展（需手动安装）
- Telegram（@zhin.js/adapter-telegram）
- Discord（@zhin.js/adapter-discord）
- QQ（@zhin.js/adapter-qq）
- KOOK（@zhin.js/adapter-kook）
- OneBot v11（@zhin.js/adapter-onebot11）
- MySQL（@zhin.js/database-mysql）
- PostgreSQL（@zhin.js/database-pg）

## 📚 更多资源
- 📖 [API 文档](../api/) - 详细的 API 参考
- 💡 [代码示例](../examples/) - 更多实用示例
- 🔌 [适配器开发](../adapter/) - 自定义适配器开发

---

💡 **记住**: 好的代码是写给人看的，机器只是顺便执行了它。保持代码简洁、可读、可维护！