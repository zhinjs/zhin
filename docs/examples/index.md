
# 💡 实用示例代码

本文档包含了 Zhin.js 的各种实用示例代码，全部基于实际项目测试验证。

> **生态说明**：Zhin.js 开箱即用支持控制台适配器、HTTP 服务、Web 控制台、SQLite 数据库。Telegram、Discord、QQ、KOOK、OneBot v11、MySQL、PostgreSQL 等需手动安装扩展包。建议示例优先兼容主仓库内置服务，跨平台请注明依赖。

## 🚀 基础示例

### 👋 Hello World

最简单的机器人响应示例：

```typescript
// src/plugins/hello-world.ts
import { onMessage, useLogger } from 'zhin.js'

const logger = useLogger()

onMessage(async (message) => {
  if (message.$raw.includes('hello')) {
    logger.info(`用户 ${message.$sender.name} 说了 hello`)
    await message.$reply('👋 Hello World! 欢迎使用 Zhin 框架！')
  }
})

logger.info('Hello World 插件已加载')

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

### ⚡ 现代命令系统

使用 Zhin 内置命令系统：

```typescript
// src/plugins/basic-commands.ts
import { 
  addCommand, 
  MessageCommand, 
  useLogger,
  onMessage 
} from 'zhin.js'

const logger = useLogger()

// 🎯 简单命令
addCommand(new MessageCommand('ping')
  .action(async () => {
    return '🏓 Pong! 机器人运行正常'
  })
)

// 🔢 带参数的命令
addCommand(new MessageCommand('echo <message:text>')
  .action(async (message, result) => {
    const { message: text } = result.args
    return `📢 回声: ${text}`
  })
)

// ⏰ 获取时间
addCommand(new MessageCommand('time')
  .action(async () => {
    const now = new Date()
    return `🕐 当前时间: ${now.toLocaleString()}`
  })
)

// 🎲 随机数命令
addCommand(new MessageCommand('random [min:number=1] [max:number=100]')
  .action(async (message, result) => {
    const { min = 1, max = 100 } = result.args
    const random = Math.floor(Math.random() * (max - min + 1)) + min
    return `🎲 随机数 (${min}-${max}): ${random}`
  })
)

// 📊 帮助系统
addCommand(new MessageCommand('help')
  .action(async () => {
    return `📋 可用命令:
🏓 ping - 测试机器人响应
📢 echo <消息> - 回声
🕐 time - 获取当前时间  
🎲 random [最小值] [最大值] - 生成随机数
❓ help - 显示此帮助`
  })
)

logger.info('基础命令插件已加载')
```

## 🔧 功能示例

### 🌤️ 天气查询插件

带有缓存的API调用示例：

```typescript
// src/plugins/weather.ts
import { 
  addCommand, 
  MessageCommand, 
  register,
  useContext,
  useLogger 
} from 'zhin.js'

const logger = useLogger()

// 🔧 注册天气服务
register({
  name: 'weather',
  async mounted(plugin) {
    const cache = new Map<string, { data: any, expires: number }>()
    
    return {
      async getWeather(city: string) {
        const cacheKey = `weather:${city.toLowerCase()}`
        const cached = cache.get(cacheKey)
        
        // 检查缓存
        if (cached && cached.expires > Date.now()) {
          logger.debug(`天气缓存命中: ${city}`)
          return cached.data
        }
        
        try {
          // 模拟API调用 (实际使用时替换为真实API)
          const mockWeatherData = {
            city,
            temperature: Math.floor(Math.random() * 35),
            condition: ['晴', '多云', '小雨', '阴'][Math.floor(Math.random() * 4)],
            humidity: Math.floor(Math.random() * 100),
            wind: `${Math.floor(Math.random() * 10)}级`,
            updateTime: new Date().toLocaleString()
          }
          
          // 缓存5分钟
          cache.set(cacheKey, {
            data: mockWeatherData,
            expires: Date.now() + 5 * 60 * 1000
          })
          
          logger.info(`获取天气数据: ${city}`)
          return mockWeatherData
          
        } catch (error) {
          logger.error('天气API调用失败:', error)
          throw new Error('天气服务暂时不可用')
        }
      }
    }
  }
})

// 🌤️ 使用天气服务
useContext('weather', (weather) => {
  addCommand(new MessageCommand('weather <city:text>')
    .action(async (message, result) => {
      const { city } = result.args
      
      try {
        const weatherData = await weather.getWeather(city)
        
        return `🌤️ **${weatherData.city}天气**
🌡️ 温度: ${weatherData.temperature}°C
☁️ 天气: ${weatherData.condition}
💧 湿度: ${weatherData.humidity}%
💨 风力: ${weatherData.wind}
🕐 更新时间: ${weatherData.updateTime}`
        
      } catch (error) {
        logger.error('天气查询失败:', error)
        return `❌ 天气查询失败: ${error.message}`
      }
    })
  )
})

logger.info('天气查询插件已加载')
```

### 👥 群管理插件

智能群管理功能：

```typescript
// src/plugins/group-admin.ts
import { 
  onMessage,
  onGroupMessage, 
  addCommand,
  MessageCommand,
  addMiddleware,
  register,
  useContext,
  useLogger 
} from 'zhin.js'

const logger = useLogger()

// 🔧 管理员系统
register({
  name: 'admin',
  async mounted(plugin) {
    // 管理员数据存储 (生产环境建议使用数据库)
    const adminData = {
      superAdmins: new Set(['super-admin-id']),
      groupAdmins: new Map<string, Set<string>>(), // groupId -> Set<userId>
      bannedUsers: new Map<string, Set<string>>()  // groupId -> Set<userId>
    }
    
    return {
      // 检查超级管理员
      isSuperAdmin(userId: string): boolean {
        return adminData.superAdmins.has(userId)
      },
      
      // 检查群管理员
      isGroupAdmin(groupId: string, userId: string): boolean {
        const admins = adminData.groupAdmins.get(groupId)
        return admins?.has(userId) || this.isSuperAdmin(userId)
      },
      
      // 添加群管理员
      addGroupAdmin(groupId: string, userId: string): boolean {
        if (!adminData.groupAdmins.has(groupId)) {
          adminData.groupAdmins.set(groupId, new Set())
        }
        adminData.groupAdmins.get(groupId)!.add(userId)
        return true
      },
      
      // 移除群管理员
      removeGroupAdmin(groupId: string, userId: string): boolean {
        const admins = adminData.groupAdmins.get(groupId)
        return admins ? admins.delete(userId) : false
      },
      
      // 封禁用户
      banUser(groupId: string, userId: string): boolean {
        if (!adminData.bannedUsers.has(groupId)) {
          adminData.bannedUsers.set(groupId, new Set())
        }
        adminData.bannedUsers.get(groupId)!.add(userId)
        return true
      },
      
      // 解封用户
      unbanUser(groupId: string, userId: string): boolean {
        const banned = adminData.bannedUsers.get(groupId)
        return banned ? banned.delete(userId) : false
      },
      
      // 检查是否被封禁
      isBanned(groupId: string, userId: string): boolean {
        const banned = adminData.bannedUsers.get(groupId)
        return banned?.has(userId) || false
      },
      
      // 获取统计信息
      getStats() {
        return {
          superAdmins: adminData.superAdmins.size,
          groupAdmins: Array.from(adminData.groupAdmins.values())
            .reduce((sum, set) => sum + set.size, 0),
          bannedUsers: Array.from(adminData.bannedUsers.values())
            .reduce((sum, set) => sum + set.size, 0)
        }
      }
    }
  }
})

// 🛡️ 防骚扰中间件
addMiddleware(async (message, next) => {
  // 仅对群消息进行检查
  if (message.type === 'group' && message.$channel) {
    const admin = useContext('admin')
    
    if (admin && admin.isBanned(message.$channel.id, message.$sender.id)) {
      logger.warn(`被封禁用户尝试发言: ${message.$sender.name} (${message.$sender.id})`)
      return // 阻止处理被封禁用户的消息
    }
  }
  
  await next()
})

// 👥 管理命令
useContext('admin', (admin) => {
  // 添加管理员
  addCommand(new MessageCommand('admin add <user:user>')
    .action(async (message, result) => {
      if (message.type !== 'group' || !message.$channel) {
        return '❌ 此命令只能在群聊中使用'
      }
      
      if (!admin.isSuperAdmin(message.$sender.id)) {
        return '❌ 只有超级管理员才能添加群管理员'
      }
      
      const { user } = result.args
      const success = admin.addGroupAdmin(message.$channel.id, user)
      
      if (success) {
        logger.info(`新增群管理员: ${user} (群: ${message.$channel.id})`)
        return `✅ 已添加群管理员: ${user}`
      } else {
        return '❌ 添加管理员失败'
      }
    })
  )
  
  // 封禁用户
  addCommand(new MessageCommand('ban <user:user>')
    .action(async (message, result) => {
      if (message.type !== 'group' || !message.$channel) {
        return '❌ 此命令只能在群聊中使用'
      }
      
      if (!admin.isGroupAdmin(message.$channel.id, message.$sender.id)) {
        return '❌ 只有管理员才能封禁用户'
      }
      
      const { user } = result.args
      const success = admin.banUser(message.$channel.id, user)
      
      if (success) {
        logger.warn(`用户被封禁: ${user} (群: ${message.$channel.id}, 操作者: ${message.$sender.id})`)
        return `🔨 已封禁用户: ${user}`
      } else {
        return '❌ 封禁用户失败'
      }
    })
  )
  
  // 解封用户
  addCommand(new MessageCommand('unban <user:user>')
    .action(async (message, result) => {
      if (message.type !== 'group' || !message.$channel) {
        return '❌ 此命令只能在群聊中使用'
      }
      
      if (!admin.isGroupAdmin(message.$channel.id, message.$sender.id)) {
        return '❌ 只有管理员才能解封用户'
      }
      
      const { user } = result.args
      const success = admin.unbanUser(message.$channel.id, user)
      
      if (success) {
        logger.info(`用户被解封: ${user} (群: ${message.$channel.id}, 操作者: ${message.$sender.id})`)
        return `✅ 已解封用户: ${user}`
      } else {
        return '❌ 解封用户失败或用户未被封禁'
      }
    })
  )
  
  // 管理员统计
  addCommand(new MessageCommand('admin stats')
    .action(async (message) => {
      if (!admin.isSuperAdmin(message.$sender.id)) {
        return '❌ 只有超级管理员才能查看统计信息'
      }
      
      const stats = admin.getStats()
      return `📊 **管理系统统计**
👑 超级管理员: ${stats.superAdmins}
👥 群管理员: ${stats.groupAdmins}  
🔨 被封禁用户: ${stats.bannedUsers}`
    })
  )
})

logger.info('群管理插件已加载')
```

### ⏰ 定时任务插件

智能定时任务管理：

```typescript
// src/plugins/scheduler.ts
import { 
  onMounted,
  onDispose,
  sendMessage,
  useLogger,
  addCommand,
  MessageCommand
} from 'zhin.js'

const logger = useLogger()
const scheduledTasks: NodeJS.Timeout[] = []

onMounted(() => {
  // 📅 每日早报 (每天早上8点)
  const dailyReport = setInterval(async () => {
    const now = new Date()
    if (now.getHours() === 8) {
      try {
    await sendMessage({
          context: 'process',
          bot: `${process.pid}`,
          id: 'console',
          type: 'private',
          content: `🌅 早上好！新的一天开始了！
🕐 当前时间：${now.toLocaleString()}
💪 让我们开始美好的一天吧！`
        })
        logger.info('每日早报已发送')
      } catch (error) {
        logger.error('发送每日早报失败:', error)
      }
    }
  }, 60 * 60 * 1000) // 每小时检查一次
  
  // 🕐 整点报时 (工作时间)
  const hourlyChime = setInterval(async () => {
    const now = new Date()
    const hour = now.getHours()
    
    // 只在工作时间(9-18点)整点报时
    if (hour >= 9 && hour <= 18 && now.getMinutes() === 0) {
      try {
    await sendMessage({
          context: 'process',
          bot: `${process.pid}`,
          id: 'console', 
          type: 'private',
          content: `🕐 现在是${hour}点整`
        })
        logger.info(`整点报时: ${hour}点`)
      } catch (error) {
        logger.error('整点报时失败:', error)
      }
    }
  }, 60 * 1000) // 每分钟检查一次
  
  // 📊 性能监控 (每10分钟)
  const performanceCheck = setInterval(() => {
    const memUsage = process.memoryUsage()
    const uptime = process.uptime()
    
    if (memUsage.heapUsed > 100 * 1024 * 1024) { // 超过100MB
      logger.warn(`内存使用较高: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`)
    }
    
    logger.debug(`性能检查 - 运行时间: ${Math.floor(uptime)}s, 内存: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`)
  }, 10 * 60 * 1000) // 每10分钟
  
  scheduledTasks.push(dailyReport, hourlyChime, performanceCheck)
  logger.info('定时任务已启动')
})

// 🧹 清理定时任务
onDispose(() => {
  scheduledTasks.forEach(task => clearInterval(task))
  scheduledTasks.length = 0
  logger.info('定时任务已清理')
})

// 📋 查看定时任务状态
addCommand(new MessageCommand('scheduler status')
  .action(async () => {
    const uptime = process.uptime()
    const memUsage = process.memoryUsage()
    
    return `⏰ **定时任务状态**
📊 活跃任务数: ${scheduledTasks.length}
⏱️ 运行时间: ${Math.floor(uptime / 60)}分${Math.floor(uptime % 60)}秒
💾 内存使用: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB
🕐 当前时间: ${new Date().toLocaleString()}`
  })
)

logger.info('定时任务插件已加载')
```

## 🔧 高级插件示例

### 💾 数据存储插件

基于文件的轻量级数据库：

```typescript
// src/plugins/database.ts
import { 
  register, 
  onMounted,
  onDispose,
  useLogger 
} from 'zhin.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const logger = useLogger()

register({
  name: 'database',
  async mounted(plugin) {
    const dataDir = join(process.cwd(), 'data', 'storage')
    
    // 确保数据目录存在
    await fs.mkdir(dataDir, { recursive: true })
    
    // 内存缓存
    const cache = new Map<string, any>()
    
    return {
      // 📝 读取数据
      async get<T = any>(key: string): Promise<T | null> {
        // 先检查内存缓存
        if (cache.has(key)) {
          return cache.get(key)
        }
        
        try {
          const filePath = join(dataDir, `${key}.json`)
          const data = await fs.readFile(filePath, 'utf-8')
          const parsed = JSON.parse(data)
          
          // 更新缓存
          cache.set(key, parsed)
          return parsed
          
        } catch (error) {
          if ((error as any).code !== 'ENOENT') {
            logger.error(`读取数据失败 (${key}):`, error)
          }
          return null
        }
      },
      
      // ✏️ 写入数据
      async set<T = any>(key: string, value: T): Promise<boolean> {
        try {
          const filePath = join(dataDir, `${key}.json`)
          const data = JSON.stringify(value, null, 2)
          
          await fs.writeFile(filePath, data, 'utf-8')
          
          // 更新缓存
          cache.set(key, value)
          
          logger.debug(`数据已保存: ${key}`)
          return true
          
        } catch (error) {
          logger.error(`保存数据失败 (${key}):`, error)
          return false
        }
      },
      
      // 🗑️ 删除数据
      async delete(key: string): Promise<boolean> {
        try {
          const filePath = join(dataDir, `${key}.json`)
          await fs.unlink(filePath)
          
          // 清除缓存
          cache.delete(key)
          
          logger.debug(`数据已删除: ${key}`)
          return true
          
        } catch (error) {
          if ((error as any).code !== 'ENOENT') {
            logger.error(`删除数据失败 (${key}):`, error)
          }
          return false
        }
      },
      
      // 📋 列出所有键
      async keys(): Promise<string[]> {
        try {
          const files = await fs.readdir(dataDir)
          return files
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''))
        } catch (error) {
          logger.error('获取键列表失败:', error)
          return []
        }
      },
      
      // 🧹 清理缓存
      clearCache(): void {
        cache.clear()
        logger.info('数据库缓存已清理')
      },
      
      // 📊 获取统计信息
      getStats() {
        return {
          cacheSize: cache.size,
          cacheKeys: Array.from(cache.keys())
        }
      }
    }
  },
  
  async dispose(db) {
    db.clearCache()
    logger.info('数据库连接已关闭')
  }
})

logger.info('数据库插件已加载')
```

## 🎯 实用工具插件

### 🎲 娱乐功能集合

```typescript
// src/plugins/entertainment.ts
import { 
  addCommand, 
  MessageCommand, 
  onMessage,
  useLogger 
} from 'zhin.js'

const logger = useLogger()

// 🎲 掷骰子
addCommand(new MessageCommand('roll [sides:number=6] [count:number=1]')
  .action(async (message, result) => {
    const { sides = 6, count = 1 } = result.args
    
    if (count > 10) return '❌ 最多只能掷10个骰子'
    
    const results = []
    for (let i = 0; i < count; i++) {
      results.push(Math.floor(Math.random() * sides) + 1)
    }
    
    const sum = results.reduce((a, b) => a + b, 0)
    
    return `🎲 掷骰结果: ${results.join(', ')}
📊 总和: ${sum} (${count}个${sides}面骰子)`
  })
)

// 🔮 随机选择
addCommand(new MessageCommand('choose <choices:text>')
  .action(async (message, result) => {
    const choices = result.args.choices
      .split(/[,，|｜]/)
      .map(choice => choice.trim())
      .filter(choice => choice)
    
    if (choices.length < 2) {
      return '❌ 至少需要2个选项，用逗号或竖线分隔'
    }
    
    const chosen = choices[Math.floor(Math.random() * choices.length)]
    return `🔮 我选择: **${chosen}**`
  })
)

// 💬 简单聊天响应
const responses = {
  greetings: ['你好！', '嗨！', '你好呀！', '很高兴见到你！'],
  thanks: ['不客气！', '不用谢！', '没问题！', '乐意帮助！'],
  goodbye: ['再见！', '拜拜！', '下次见！', '保重！']
}

onMessage(async (message) => {
  const text = message.$raw.toLowerCase()
  
  // 问候响应
  if (['你好', 'hello', 'hi', '嗨'].some(word => text.includes(word))) {
    const response = responses.greetings[Math.floor(Math.random() * responses.greetings.length)]
    await message.$reply(response)
  }
  
  // 感谢响应
  if (['谢谢', 'thanks', '感谢'].some(word => text.includes(word))) {
    const response = responses.thanks[Math.floor(Math.random() * responses.thanks.length)]
    await message.$reply(response)
  }
})

logger.info('娱乐插件已加载')
```

## 🔗 完整项目示例

### 📂 项目结构

基于 [`test-bot`](https://github.com/zhinjs/zhin/tree/main/test-bot) 目录的完整示例项目：

```
test-bot/                    # 完整的机器人项目示例
├── src/
│   ├── index.ts            # ✅ 应用入口，包含优雅关闭
│   └── plugins/
│       └── test-plugin.ts  # ✅ 完整功能插件示例
├── data/                   # 💾 运行时数据目录
├── zhin.config.ts         # ⚙️ 生产级配置文件
├── package.json           # 📦 完整依赖配置
├── tsconfig.json          # 🎯 TypeScript配置
└── README.md              # 📖 项目文档
```

### 🎯 关键特性演示

**1. 多平台支持**
- ✅ 控制台适配器 (开发调试)
- ✅ ICQQ 适配器 (QQ机器人)
- ✅ KOOK 适配器 (KOOK机器人) 
- ✅ OneBot v11 适配器 (通用协议)

**2. 热重载开发**
```bash
# 启动开发服务器，支持热重载
pnpm dev

# 修改插件代码，自动重新加载
# 无需重启，开发效率极高
```

**3. 生产部署**
```bash
# 构建项目
pnpm build

# 生产环境启动 (使用Bun获得更好性能)
pnpm start --bun --daemon
```

**4. 配置管理**
```javascript
// zhin.config.ts - 生产级配置
export default defineConfig(async (env) => {
  return {
    bots: [
      { name: `${process.pid}`, context: 'process' },
      { name: env.BOT_NAME, context: 'icqq', uin: env.QQ_UIN }
    ],
    plugins: [
      'adapter-process', 'adapter-icqq',
      'http', 'console', 'test-plugin'
    ],
    debug: env.DEBUG === 'true'
  }
})
```

## 🔧 开发工具推荐

### VS Code 插件推荐

```json
// .vscode/extensions.json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss", 
    "esbenp.prettier-vscode"
  ]
}
```

### 调试配置

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "调试机器人",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/zhin",
      "args": ["dev"],
      "env": {
        "DEBUG": "true"
      }
    }
  ]
}
```

## 📚 更多资源

- 📖 [完整 API 参考](../api/index.md) - 详细的接口文档
- 🧩 [插件开发指南](../plugin/index.md) - 深入的插件开发教程
- 🔌 [适配器开发指南](../adapter/index.md) - 创建自定义适配器
- 🚀 [最佳实践指南](../guide/best-practices.md) - 生产环境优化建议
- 💡 [test-bot 项目](https://github.com/zhinjs/zhin/tree/main/test-bot) - 完整的实际项目示例

---

💡 **提示**: 所有示例代码都经过实际测试，可以直接复制使用。建议从简单示例开始，逐步学习更复杂的功能。
