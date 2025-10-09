# 🚀 60秒极速体验

在一分钟内体验 zhin-next 的强大功能！

## ⚡ **一键启动**

```bash
# 🎯 创建项目（自动配置）
npm create zhin my-awesome-bot -- --yes

# 📁 进入目录并启动
cd my-awesome-bot && npm run dev
```

🎉 **就这么简单！** 你的机器人已经启动并运行了！

---

## 💬 **立即测试**

启动后，你可以在终端直接输入消息进行测试：

```bash
# 🌟 在终端输入以下消息测试

> hello
< 你好！欢迎使用 Zhin 机器人框架！

> status  
< 🤖 机器人状态
  ⏱️ 运行时间: 30秒
  📊 内存使用: 42.15MB
  🔧 Node.js: v18.17.0

> roll 20
< 🎲 你掷出了 15 点！（20 面骰子）
```

---

## 🌐 **Web 控制台**

同时打开浏览器访问：**http://localhost:3000**（开发时访问）

🎛️ **你将看到：**
- 📊 **实时状态监控** - CPU、内存、消息统计
- 🧩 **插件管理界面** - 热插拔插件，实时生效
- 📝 **实时日志查看** - 彩色输出，过滤功能
- ⚙️ **配置编辑器** - 所见即所得的配置管理
- 🎯 **API 测试工具** - 直接测试机器人接口

---

## 🔥 **体验热重载魔法**

### 1️⃣ **编辑插件代码**

打开 `src/plugins/test-plugin.ts`，添加新功能：

```typescript
// 🎯 添加一个新命令
addCommand(new MessageCommand('magic')
  .action(async () => {
    return '✨ 这是热重载添加的新功能！'
  })
)
```

### 2️⃣ **保存文件**

**Ctrl + S** 保存后，终端会显示：

```bash
[INFO] test-plugin.ts reloaded successfully in 180ms
```

### 3️⃣ **立即测试**

```bash
> magic
< ✨ 这是热重载添加的新功能！
```

**🔥 无需重启，新功能立即生效！**

---

## 🎯 **探索生成的项目**

### 📁 **项目结构**
```
my-awesome-bot/
├── src/
│   ├── index.ts              # 🎯 主入口
│   └── plugins/
│       └── test-plugin.ts    # 🧩 示例插件
├── zhin.config.ts           # ⚙️ 配置文件  
├── .env.example            # 🔐 环境变量模板
└── package.json            # 📦 依赖管理
```

### ⚙️ **智能配置**

生成的 `zhin.config.ts` 包含最佳实践配置：

```javascript
import { defineConfig } from 'zhin.js'

export default defineConfig(async (env) => ({
  // 🤖 机器人实例（支持多个）
  bots: [{
    name: `${process.pid}`,    // 动态名称
    context: 'process'         // 控制台适配器
  }],
  
  // 🧩 自动发现插件
  plugins: [
    'adapter-process',  // 控制台支持
    'http',            // HTTP 服务器
    'console',         // Web 控制台
    'test-plugin'      // 你的测试插件
  ],
  
  // 🐛 开发模式
  debug: env.DEBUG === 'true'
}))
```

### 🧩 **功能丰富的示例插件**

生成的 `test-plugin.ts` 展示了核心功能：

```typescript
import { 
  addCommand, 
  addMiddleware, 
  onMessage, 
  useContext,
  useLogger 
} from 'zhin.js'

const logger = useLogger()

// 🎯 命令处理
addCommand(new MessageCommand('hello')
  .action(() => '你好！欢迎使用 Zhin 机器人框架！'))

// 📊 状态查询  
addCommand(new MessageCommand('status')
  .action(() => {
    const uptime = process.uptime() * 1000
    const memory = process.memoryUsage()
    return [
      '🤖 机器人状态',
      `⏱️ 运行时间: ${formatTime(uptime)}`,
      `📊 内存使用: ${(memory.rss / 1024 / 1024).toFixed(2)}MB`,
      `🔧 Node.js: ${process.version}`
    ].join('\n')
  }))

// 🎲 骰子游戏
addCommand(new MessageCommand('roll [sides:number=6]')
  .action((message, result) => {
    const sides = result.args.sides || 6
    const roll = Math.floor(Math.random() * sides) + 1
    return `🎲 你掷出了 ${roll} 点！（${sides} 面骰子）`
  }))

// 🔧 中间件示例
addMiddleware(async (message, next) => {
  logger.info(`收到消息: ${message.raw}`)
  await next()
})

// 🎯 依赖注入示例
useContext('process', () => {
  logger.info('Process 适配器已就绪，可以在控制台输入消息测试')
})
```

---

## 🌟 **下一步探索**

### 🎯 **5分钟挑战**

尝试以下任务，进一步体验 zhin-next 的强大功能：

#### **任务1: 添加天气查询**
```typescript
// 在 test-plugin.ts 中添加
addCommand(new MessageCommand('weather <city>')
  .action(async (message, result) => {
    const city = result.args.city
    // 🌤️ 这里可以调用真实的天气 API
    return `${city} 今天天气：☀️ 晴朗，25°C`
  }))
```

#### **任务2: 添加数据存储**
```typescript
// 🗄️ 使用内置的上下文存储
useContext('process', () => {
  const userData = new Map() // 简单的内存存储
  
  addCommand(new MessageCommand('save <key> <value>')
    .action((message, result) => {
      userData.set(result.args.key, result.args.value)
      return `✅ 已保存: ${result.args.key} = ${result.args.value}`
    }))
    
  addCommand(new MessageCommand('get <key>')
    .action((message, result) => {
      const value = userData.get(result.args.key)
      return value ? `📝 ${result.args.key} = ${value}` : `❌ 未找到 ${result.args.key}`
    }))
})
```

#### **任务3: 添加定时任务**
```typescript
// ⏰ 定时发送消息
useContext('process', () => {
  setInterval(() => {
    console.log('🕐 定时提醒：已运行 1 分钟')
  }, 60000)
})
```

### 🌐 **配置其他平台**

#### **连接 QQ (ICQQ)**
```bash
# 1. 安装 QQ 适配器
npm install @zhin.js/adapter-icqq

# 2. 添加环境变量到 .env
echo "QQ_ACCOUNT=123456789" >> .env
echo "QQ_PASSWORD=your-password" >> .env
```

```javascript
// 3. 更新 zhin.config.ts
export default defineConfig(async (env) => ({
  bots: [
    // 保留控制台用于开发测试
    { name: 'console-bot', context: 'process' },
    
    // 添加 QQ 机器人
    {
      name: 'qq-bot',
      context: 'icqq',
      uin: parseInt(env.QQ_ACCOUNT),
      password: env.QQ_PASSWORD,
      platform: 4  // 手机 QQ
    }
  ],
  plugins: [
    'adapter-process',
    'adapter-icqq',  // 添加 ICQQ 适配器
    'http',
    'console',
    'test-plugin'
  ]
}))
```

#### **连接 Discord**
```bash
npm install @zhin.js/adapter-discord
echo "DISCORD_TOKEN=your-bot-token" >> .env
```

#### **连接 Telegram**  
```bash
npm install @zhin.js/adapter-telegram
echo "TELEGRAM_TOKEN=your-bot-token" >> .env
```

---

## 🎓 **学习路径建议**

### 📚 **新手路线 (1小时)**
1. ✅ **60秒体验** - 你已完成！
2. 📖 **[快速开始](/guide/getting-started)** - 理解框架基础 (15分钟)
3. 🧩 **[核心创新](/guide/innovations)** - 学习技术特色 (20分钟)
4. 🌐 **[架构设计](/guide/architecture)** - 了解设计思想 (20分钟)

### 🚀 **进阶路线 (半天)**
1. 🔥 **[核心创新技术](/guide/innovations)** - 掌握核心机制 (1小时)
2. ⚡ **[架构设计解析](/guide/architecture)** - 理解技术细节 (45分钟)  
3. 🏗️ **[架构设计](/guide/architecture)** - 深入架构思想 (1小时)
4. 🎯 **[最佳实践](/guide/best-practices)** - 生产环境指南 (45分钟)

### 🏆 **专家路线 (1天)**
1. 🧠 **[架构设计深度解析](/guide/architecture)** - 源码解析 (2小时)
2. 🔧 **[适配器开发](/adapter/)** - 适配新平台 (2小时)
3. 📊 **[最佳实践](/guide/best-practices)** - 高级调优 (2小时)
4. 🤝 **[GitHub 贡献](https://github.com/zhinjs/zhin)** - 参与开源 (2小时)

---

## 🆘 **遇到问题？**

### 🔧 **常见问题**

**Q: 端口被占用怎么办？**
```bash
# 🔍 查找占用进程
lsof -i :3000

# ⚙️ 或者修改端口
export PORT=3001 && npm run dev
```

**Q: 热重载不生效？**
```bash
# ✅ 检查文件是否在正确目录
ls src/plugins/

# 🔍 检查控制台是否有错误信息  
# 确保文件语法正确
```

**Q: 如何调试插件？**
```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()
logger.debug('调试信息')  // 需要开启 debug: true
```

### 💬 **获得帮助**

- 🌟 **[GitHub Issues](https://github.com/zhinjs/zhin/issues)** - 报告 Bug
- 💬 **[GitHub Discussions](https://github.com/zhinjs/zhin/discussions)** - 技术讨论  
- 📚 **[完整文档](/)** - 详细教程和API文档
- 🎯 **[示例项目](https://github.com/zhinjs/examples)** - 更多实用示例

---

🎉 **恭喜！你已经掌握了 zhin-next 的基础使用。**

**现在开始构建属于你的智能机器人吧！** 🤖✨

👉 **[深入学习架构设计](/guide/architecture)** • **[探索核心创新](/guide/innovations)**
