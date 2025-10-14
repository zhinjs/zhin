# @zhin.js/cli

Zhin 机器人框架的命令行工具，提供项目管理、开发、构建和部署的完整工具链。

## 特性

- 🚀 **快速创建项目** - 通过交互式向导创建新的机器人项目
- 🔥 **开发模式** - 支持热重载的开发服务器
- 📦 **构建工具** - 编译 TypeScript 项目为生产就绪的代码
- 🎯 **进程管理** - 启动、停止、重启机器人进程
- 🛠️ **环境管理** - 支持 .env 文件和环境变量配置

## 安装

```bash
pnpm add @zhin.js/cli
```

或全局安装：

```bash
pnpm add -g @zhin.js/cli
```

## 使用

### 命令概览

```bash
zhin <command> [options]
```

### 可用命令

#### `zhin init`

初始化一个新的 Zhin 机器人项目。

```bash
zhin init [project-name]
```

**选项：**
- `[project-name]` - 项目名称（可选，如果未提供将通过交互式提示询问）

**示例：**
```bash
# 交互式创建项目
zhin init

# 直接指定项目名
zhin init my-bot
```

#### `zhin dev`

启动开发服务器，支持热重载。

```bash
zhin dev [options]
```

**选项：**
- `--config <path>` - 指定配置文件路径（默认：`zhin.config.ts`）
- `--port <port>` - 指定服务器端口（默认：8086）

**示例：**
```bash
# 使用默认配置
zhin dev

# 指定配置文件
zhin dev --config ./custom.config.ts

# 指定端口
zhin dev --port 3000
```

**特性：**
- 自动监听文件变更
- 插件热重载
- 配置热更新
- 实时日志输出

#### `zhin start`

启动生产环境的机器人。

```bash
zhin start [options]
```

**选项：**
- `--config <path>` - 指定配置文件路径
- `--daemon` - 以守护进程模式运行

**示例：**
```bash
# 前台运行
zhin start

# 后台运行
zhin start --daemon
```

#### `zhin stop`

停止正在运行的机器人进程。

```bash
zhin stop
```

**示例：**
```bash
zhin stop
```

#### `zhin restart`

重启正在运行的机器人进程。

```bash
zhin restart [options]
```

**选项：**
- `--config <path>` - 指定配置文件路径

**示例：**
```bash
zhin restart
```

#### `zhin build`

构建项目为生产就绪的代码。

```bash
zhin build [options]
```

**选项：**
- `--outDir <dir>` - 指定输出目录（默认：`lib`）
- `--clean` - 构建前清理输出目录

**示例：**
```bash
# 默认构建
zhin build

# 指定输出目录
zhin build --outDir dist

# 清理后构建
zhin build --clean
```

## 项目结构

使用 CLI 创建的项目具有以下结构：

```
my-bot/
├── src/                    # 源代码目录
│   ├── plugins/           # 自定义插件
│   └── index.ts           # 入口文件
├── config/                 # 配置目录
│   └── default.yml        # 默认配置
├── data/                   # 数据目录
│   └── bot.db            # SQLite 数据库
├── logs/                   # 日志目录
├── zhin.config.ts         # Zhin 配置文件
├── tsconfig.json          # TypeScript 配置
├── package.json           # 项目配置
└── .env                   # 环境变量（可选）
```

## 配置文件

### zhin.config.ts

主配置文件，定义机器人的行为：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  // 机器人配置
  bots: [
    {
      name: 'console',
      context: 'process',
    }
  ],
  
  // 插件配置
  plugins: [
    'http',
    'console',
    'adapter-process',
  ],
  
  // 插件目录
  plugin_dirs: [
    './src/plugins',
    'node_modules',
    'node_modules/@zhin.js'
  ],
  
  // 数据库配置
  databases: [
    {
      name: 'main',
      type: 'sqlite',
      database: './data/bot.db'
    }
  ],
  
  // 日志配置
  log_level: 'info',
  
  // 服务器配置
  port: 8086,
})
```

### .env 文件

存储敏感信息和环境变量：

```env
# Bot Token
BOT_TOKEN=your_bot_token_here

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=password

# 其他配置
NODE_ENV=production
LOG_LEVEL=info
```

## 环境变量

CLI 支持以下环境变量：

- `NODE_ENV` - 运行环境（development/production）
- `ZHIN_CONFIG` - 配置文件路径
- `ZHIN_PORT` - 服务器端口
- `LOG_LEVEL` - 日志级别（debug/info/warn/error）
- `ZHIN_PID_FILE` - PID 文件路径

## 进程管理

### 守护进程模式

使用守护进程模式在后台运行机器人：

```bash
# 启动守护进程
zhin start --daemon

# 查看进程状态
ps aux | grep zhin

# 停止守护进程
zhin stop
```

### PID 文件

守护进程模式下，CLI 会创建一个 PID 文件：

```
.zhin-dev.pid    # 开发模式
.zhin-prod.pid   # 生产模式
```

## 开发工具

### 日志查看

开发模式下，日志会实时输出到控制台：

```bash
zhin dev
```

### 调试模式

启用详细日志：

```bash
LOG_LEVEL=debug zhin dev
```

## 最佳实践

### 1. 使用 TypeScript

强烈建议使用 TypeScript 开发，获得完整的类型支持：

```typescript
import { Plugin } from 'zhin.js'

export default new Plugin({
  name: 'my-plugin',
  setup() {
    // 插件逻辑
  }
})
```

### 2. 环境分离

为不同环境使用不同的配置：

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

const isDev = process.env.NODE_ENV === 'development'

export default defineConfig({
  log_level: isDev ? 'debug' : 'info',
  plugins: [
    'http',
    'console',
    ...(isDev ? ['dev-plugin'] : []),
  ]
})
```

### 3. 版本控制

`.gitignore` 推荐配置：

```gitignore
# 依赖
node_modules/

# 构建产物
lib/
dist/

# 数据
data/
*.db

# 日志
logs/
*.log

# 环境变量
.env
.env.local

# 进程文件
*.pid
```

### 4. 热重载最佳实践

- 保持插件独立，避免全局状态
- 使用 `onDispose` 清理资源
- 避免在顶层执行副作用代码

```typescript
export default new Plugin({
  name: 'example',
  setup(plugin) {
    const timer = setInterval(() => {
      // 定时任务
    }, 1000)
    
    // 清理资源
    plugin.onDispose(() => {
      clearInterval(timer)
    })
  }
})
```

## 故障排除

### 端口占用

如果遇到端口占用错误：

```bash
# 查找占用端口的进程
lsof -i :8086

# 终止进程
kill -9 <PID>

# 或使用其他端口
zhin dev --port 3000
```

### 构建失败

检查 TypeScript 配置：

```bash
# 检查类型错误
tsc --noEmit

# 清理缓存
rm -rf node_modules/.cache
```

### 热重载不工作

- 确保文件保存成功
- 检查文件监听器是否正常
- 查看控制台错误信息

## API 参考

### 进程工具

```typescript
import { startProcess, stopProcess } from '@zhin.js/cli'

// 启动进程
await startProcess({
  config: './zhin.config.ts',
  daemon: false,
})

// 停止进程
await stopProcess()
```

### 环境工具

```typescript
import { loadEnv, getEnv } from '@zhin.js/cli'

// 加载 .env 文件
loadEnv()

// 获取环境变量
const port = getEnv('PORT', 8086)
```

## 相关资源

- [Zhin.js 文档](https://docs.zhin.dev)
- [插件开发指南](https://docs.zhin.dev/plugin/getting-started)
- [配置参考](https://docs.zhin.dev/guide/configuration)
- [API 文档](https://docs.zhin.dev/api/core)

## 许可证

MIT License
