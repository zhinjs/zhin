# 🚀 入门指南

本指南将帮助你快速上手 Zhin Bot Framework，从零开始创建并运行你的第一个智能机器人。

## 📋 环境要求

在开始之前，请确保你的开发环境满足以下要求：

- **Node.js** >= 18.0.0（推荐使用 LTS 版本）
- **包管理器**: pnpm >= 8.0.0（推荐）、npm 或 yarn
- **TypeScript** >= 5.0.0（框架已内置，无需手动安装）
- **操作系统**: Windows 10+、macOS 10.15+、Linux（现代发行版）

### 🔍 环境检查

```bash
# 检查 Node.js 版本
node --version  # 应该 >= 18.0.0

# 检查包管理器
pnpm --version  # 推荐使用 pnpm
# 或
npm --version
```

## ⚡ 快速创建项目

使用官方脚手架一键创建新项目：

```bash
# 🎯 推荐方式（使用 npm）
npm create zhin my-awesome-bot

# 📦 使用 pnpm
pnpm create zhin my-awesome-bot

# 🧶 使用 yarn
yarn create zhin my-awesome-bot
```

### 🛠️ 交互式配置

脚手架会引导你完成项目配置：

1. **项目名称** - 输入你的机器人项目名称
2. **配置格式** - 选择配置文件格式：
   - `JavaScript (.js)` - 推荐，支持动态配置
   - `TypeScript (.ts)` - 完整类型支持
   - `JSON (.json)` - 简单静态配置
   - `YAML (.yaml)` - 人性化格式
   - `TOML (.toml)` - 结构化配置
3. **包管理器** - 选择包管理器（pnpm/npm/yarn）
4. **运行时** - 选择运行时（Node.js/Bun）

### 🚀 快速创建（跳过交互）

```bash
# 使用默认配置快速创建
npm create zhin my-bot -- --yes

# 或指定具体配置
npm create zhin my-bot -- \
  --config js \
  --package-manager pnpm \
  --runtime bun \
  --yes
```

## 📁 项目结构解析

创建完成后，项目结构如下：

```
my-awesome-bot/
├── src/                    # 📝 源代码目录
│   ├── index.ts           # 🎯 主入口文件
│   └── plugins/           # 🧩 插件目录
│       └── test-plugin.ts # 📋 示例插件
├── lib/                  # 📦 构建输出目录
├── data/                  # 💾 数据存储目录
├── .env.example          # 🔐 环境变量示例
├── zhin.config.ts        # ⚙️ 机器人配置文件
├── package.json          # 📋 项目依赖配置
├── tsconfig.json         # 🎯 TypeScript 配置
├── .gitignore           # 🚫 Git 忽略规则
└── README.md            # 📖 项目说明文档
```

### 🗂️ 目录说明

- **`src/`** - 存放所有源代码，支持 TypeScript
- **`src/plugins/`** - 插件目录，每个 `.ts` 文件都是一个插件
- **`lib/`** - 编译后的 JavaScript 文件（生产环境使用）
- **`data/`** - 存放机器人运行时数据（日志、缓存、会话等）
- **`.env.example`** - 环境变量模板，复制为 `.env` 后配置敏感信息

## ⚙️ 配置文件详解

`zhin.config.ts` 是机器人的核心配置文件，基于实际项目生成的配置：

```javascript
import { defineConfig } from 'zhin.js';

export default defineConfig(async (env) => {
  return {
    // 🤖 机器人实例配置
    bots: [
      {
        name: `${process.pid}`,  // 使用进程ID作为机器人名称
        context: 'process'       // 使用控制台适配器（便于开发测试）
      }
      // 可以配置多个机器人实例
      // {
      //   name: 'qq-bot',
      //   context: 'icqq',
      //   account: parseInt(env.QQ_ACCOUNT),
      //   password: env.QQ_PASSWORD
      // }
    ],
    
    // 📂 插件目录配置
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',  // 自定义插件目录
      'node_modules'                      // npm 插件目录
    ],
    
    // 🧩 启用的插件列表
    plugins: [
      'adapter-process',  // 控制台适配器
      'http',            // HTTP 服务器
      'console',         // Web 控制台
      'test-plugin'      // 你的测试插件
    ],

    // 🐛 调试模式（开发时建议开启）
    debug: env.DEBUG === 'true'
  };
});
```

### 🔐 环境变量配置

复制 `.env.example` 为 `.env` 并配置敏感信息：

```bash
# 复制环境变量模板
cp .env.example .env
```

`.env` 文件内容示例：

```bash
# 🐛 调试模式
DEBUG=true

# 📂 插件目录（可选，默认为 ./src/plugins）
# PLUGIN_DIR=./src/plugins

# 🤖 QQ机器人配置（如果使用 ICQQ 适配器）
# QQ_ACCOUNT=123456789
# QQ_PASSWORD=your-password

# 🎮 KOOK机器人配置（如果使用 KOOK 适配器）
# KOOK_TOKEN=your-kook-token

# 🔗 OneBot配置（如果使用 OneBot 适配器）
# BOT_URL=ws://localhost:8080
# ACCESS_TOKEN=your-access-token
```

## 🔥 开发模式

### 启动开发服务器

```bash
# 📁 进入项目目录
cd my-awesome-bot

# 📦 安装依赖（如果还没安装）
pnpm install

# 🚀 启动开发服务器
pnpm dev
```

### 🌟 开发模式特性

- ⚡ **实时热重载** - 代码修改立即生效，无需重启
- 🔍 **详细日志** - 完整的调试信息和错误堆栈
- 🎯 **自动类型检查** - TypeScript 实时错误提示
- 🌐 **Web 控制台** - 浏览器访问 `http://localhost:3000` 查看状态

### 💬 测试机器人

开发服务器启动后，你可以直接在控制台输入消息测试：

```bash
# 在终端中输入消息进行测试
> hello
< 你好！欢迎使用 Zhin 机器人框架！

> status
< 🤖 机器人状态
  ⏱️ 运行时间: 1分钟30秒
  📊 内存使用: 45.23MB
  🔧 Node.js: v18.17.0

> 帮助
< 可用命令：hello, status
  输入命令即可使用！
```

## 🧩 编写插件

### 查看示例插件

生成的项目已包含一个完整的示例插件 `src/plugins/test-plugin.ts`：

```typescript
import {
  useLogger,
  onMessage,
  addCommand,
  addMiddleware,
  MessageCommand,
  useContext,
  onDispose,
} from 'zhin.js';

const logger = useLogger();

// 📋 添加命令
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    logger.info('Hello command called by:', message.sender.name);
    return '你好！欢迎使用 Zhin 机器人框架！';
  })
);

// 📊 状态查询命令
addCommand(new MessageCommand('status')
  .action(() => {
    const uptime = process.uptime() * 1000;
    const memory = process.memoryUsage();
    return [
      '🤖 机器人状态',
      `⏱️ 运行时间: ${formatTime(uptime)}`,
      `📊 内存使用: ${(memory.rss / 1024 / 1024).toFixed(2)}MB`,
      `🔧 Node.js: ${process.version}`
    ].join('\n');
  })
);

// 🔧 添加中间件
addMiddleware(async (message, next) => {
  logger.info(`收到消息: ${message.raw}`);
  await next();
});

// 💬 监听消息
onMessage(async (message) => {
  if (message.raw.includes('帮助')) {
    await message.reply('可用命令：hello, status\n输入命令即可使用！');
  }
});

// 🎯 使用上下文依赖
useContext('process', () => {
  logger.info('Process 适配器已就绪，可以在控制台输入消息进行测试');
});

// 🧹 清理资源
onDispose(() => {
  logger.info('测试插件已销毁');
});

// 🛠️ 工具函数
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天 ${hours % 24}小时`;
  if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
  return `${seconds}秒`;
}

logger.info('测试插件已加载');
```

### 🎯 创建你的第一个插件

在 `src/plugins/` 目录下创建新文件 `my-first-plugin.ts`：

```typescript
import {
  onMessage,
  addCommand,
  MessageCommand,
  useLogger,
  addMiddleware
} from 'zhin.js';

const logger = useLogger();

// 🎲 骰子命令
addCommand(new MessageCommand('roll [sides:number=6]')
  .action(async (message, result) => {
    const sides = result.args.sides || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    return `🎲 你掷出了 ${roll} 点！（${sides} 面骰子）`;
  })
);

// 🌍 问候插件
onMessage(async (message) => {
  const greetings = ['你好', 'hello', 'hi', '早上好', '晚上好'];
  const text = message.raw.toLowerCase();
  
  if (greetings.some(greeting => text.includes(greeting))) {
    const responses = [
      '你好呀！👋',
      '嗨！很高兴见到你！',
      '早安！今天过得怎么样？',
      '晚上好！休息得好吗？'
    ];
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    await message.reply(randomResponse);
  }
});

// 📝 日志中间件
addMiddleware(async (message, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.debug(`消息处理耗时: ${duration}ms`);
});

logger.info('我的第一个插件已加载 🎉');
```

### 🔄 热重载测试

保存文件后，插件会自动重新加载，你可以立即测试新功能：

```bash
> roll
< 🎲 你掷出了 3 点！（6 面骰子）

> roll 20
< 🎲 你掷出了 15 点！（20 面骰子）

> 你好
< 你好呀！👋
```

## 🚀 生产部署

### 构建项目

```bash
# 🔨 编译 TypeScript 为生产环境 JavaScript
pnpm build
```

### 启动方式

```bash
# 🖥️ 前台启动（适合调试）
pnpm start

# 🌙 后台启动（适合生产环境）
pnpm start --daemon

# 📝 后台启动并记录日志
pnpm start --daemon --log-file ./logs/production.log

# ⚡ 使用 Bun 运行时启动（更高性能）
pnpm start --bun --daemon
```

### 进程管理

```bash
# 🔄 重启机器人
pnpm restart

# 🛑 停止机器人
pnpm stop

# 📊 查看运行状态
ps aux | grep zhin
```

### 🐳 Docker 部署

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
COPY pnpm-lock.yaml ./

# 安装 pnpm 并安装依赖
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建项目
RUN pnpm build

# 暴露端口（如果使用 HTTP 插件）
EXPOSE 3000

# 启动命令
CMD ["pnpm", "start", "--daemon"]
```

## 🎯 下一步

### 📚 学习路径

1. **📖 深入了解** - [框架核心概念](./concepts.md)
2. **🔧 掌握 API** - [完整 API 参考](../api/README.md)
3. **🧩 插件开发** - [插件开发指南](../plugin/README.md)
4. **🚀 最佳实践** - [生产环境优化](./best-practices.md)
5. **💡 获取灵感** - [实用示例集合](../examples/README.md)

### 🌐 配置其他平台

```javascript
// zhin.config.ts - 添加 QQ 机器人
export default defineConfig(async (env) => {
  return {
    bots: [
      // 开发测试用的控制台
      { name: `${process.pid}`, context: 'process' },
      
      // QQ 机器人（需要配置环境变量）
      {
        name: 'qq-bot',
        context: 'icqq',
        uin: parseInt(env.QQ_ACCOUNT),
        password: env.QQ_PASSWORD,
        platform: 4  // 手机QQ
      }
    ],
    plugins: [
      'adapter-process',
      'adapter-icqq',  // 添加 ICQQ 适配器
      'http',
      'console',
      'test-plugin'
    ]
  };
});
```

## ❓ 常见问题

### Q: 如何更新框架版本？

```bash
# 📦 更新所有 Zhin 相关包
pnpm update zhin.js @zhin.js/cli @zhin.js/adapter-*

# 🔍 检查版本
pnpm list | grep zhin
```

### Q: 如何调试插件？

**方法 1: 使用日志调试**
```typescript
import { useLogger } from 'zhin.js';

const logger = useLogger();
logger.debug('调试信息');  // 需要开启 debug: true
logger.info('普通信息');
logger.warn('警告信息');
logger.error('错误信息');
```

**方法 2: VSCode 调试**
```bash
# 启动调试模式
node --inspect-brk node_modules/.bin/zhin dev

# 然后在 VSCode 中附加到进程
```

### Q: 插件热重载不工作？

**检查清单：**
- ✅ 文件保存在 `src/plugins/` 目录
- ✅ 文件扩展名为 `.ts` 或 `.js`
- ✅ 运行在 `dev` 模式
- ✅ 插件名称在配置中启用

### Q: 如何处理异步错误？

```typescript
import { useLogger } from 'zhin.js';

const logger = useLogger();

// 🛡️ 包装异步函数
async function safeAsyncOperation() {
  try {
    await riskyOperation();
  } catch (error) {
    logger.error('操作失败:', error);
    // 不要 throw，让程序继续运行
  }
}

// 🔄 监听未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的 Promise 拒绝:', reason);
});
```

### Q: 性能优化建议？

1. **📊 使用性能监控**
   ```typescript
   const app = useApp();
   const stats = app.getPerformanceStats();
   console.log('性能统计:', stats);
   ```

2. **🎯 避免频繁重载**
   ```typescript
   // ❌ 避免在热点函数中使用
   onMessage(() => { /* heavy work */ });
   
   // ✅ 使用中间件和条件判断
   addMiddleware(async (message, next) => {
     if (shouldProcess(message)) {
       await heavyWork(message);
     }
     await next();
   });
   ```

3. **💾 合理使用缓存**
   ```typescript
   import { register } from 'zhin.js';
   
   register({
     name: 'cache',
     mounted() {
       const cache = new Map();
       return {
         get: (key) => cache.get(key),
         set: (key, value) => cache.set(key, value)
       };
     }
   });
   ```

## 🆘 获取帮助

### 📋 提问前的检查清单

- [ ] 🔍 搜索过[已有问题](https://github.com/zhinjs/zhin/issues)
- [ ] 📖 阅读过相关文档
- [ ] ✅ 提供完整的错误信息
- [ ] 🔧 包含最小重现代码

### 🌐 社区资源

- 💬 [GitHub Discussions](https://github.com/zhinjs/zhin/discussions) - 讨论和交流
- 🐛 [GitHub Issues](https://github.com/zhinjs/zhin/issues) - Bug 报告和功能请求
- 📚 [官方文档](https://zhinjs.github.io) - 完整教程和 API 文档
- 🎯 [Awesome Zhin](https://github.com/zhinjs/awesome-zhin) - 社区插件和资源

---

🎉 **恭喜！** 你已经完成了 Zhin 框架的入门学习。现在可以开始构建属于你的智能机器人了！
