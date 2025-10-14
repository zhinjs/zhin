# create-zhin-app

快速创建 Zhin 机器人项目的脚手架工具。

## 特性

- 🚀 **快速创建** - 一条命令即可创建完整项目
- 📦 **开箱即用** - 预配置好的项目结构
- 🎨 **交互式** - 友好的命令行交互界面
- 🔧 **灵活配置** - 支持自定义项目模板
- 📝 **完整示例** - 包含示例插件和配置

## 使用

### 使用 pnpm（推荐）

```bash
pnpm create zhin-app my-bot
```

### 使用 npm

```bash
npm create zhin-app my-bot
```

### 使用 yarn

```bash
yarn create zhin-app my-bot
```

## 交互式创建

不指定项目名称，将进入交互式创建模式：

```bash
pnpm create zhin-app
```

系统将提示你输入：

1. **项目名称** - 你的机器人项目名称
2. **项目描述** - 项目的简短描述
3. **作者** - 你的名字
4. **选择模板** - 选择项目模板（基础/完整）
5. **包管理器** - 选择 pnpm/npm/yarn

## 项目结构

创建的项目具有以下结构：

```
my-bot/
├── src/                    # 源代码目录
│   ├── plugins/           # 自定义插件目录
│   │   └── example.ts     # 示例插件
│   └── index.ts           # 应用入口
├── config/                 # 配置目录
│   └── default.yml        # 默认配置文件
├── data/                   # 数据目录
│   └── .gitkeep          # Git占位文件
├── logs/                   # 日志目录
│   └── .gitkeep          # Git占位文件
├── zhin.config.ts         # Zhin配置文件
├── tsconfig.json          # TypeScript配置
├── package.json           # 项目配置
├── .gitignore             # Git忽略文件
└── README.md              # 项目说明
```

## 项目模板

### 基础模板

最小化的项目配置，适合从零开始：

- 控制台适配器
- 基本插件结构
- SQLite 数据库
- 简单示例

### 完整模板

包含更多功能的模板：

- HTTP 服务器
- Web 控制台
- 多个适配器
- 完整示例插件
- 数据库模型示例

## 创建后的步骤

1. **进入项目目录**

```bash
cd my-bot
```

2. **安装依赖**

```bash
pnpm install
```

3. **启动开发模式**

```bash
pnpm dev
```

4. **或启动生产模式**

```bash
pnpm start
```

## 可用脚本

创建的项目包含以下脚本：

```bash
# 开发模式（热重载）
pnpm dev

# 生产模式
pnpm start

# 后台运行
pnpm daemon

# 停止后台进程
pnpm stop

# 构建项目
pnpm build

# 清理构建产物
pnpm clean
```

## 配置文件

### zhin.config.ts

主配置文件，定义机器人行为：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      name: 'console',
      context: 'process'
    }
  ],
  plugins: [
    'http',
    'console',
    'adapter-process'
  ],
  plugin_dirs: [
    './src/plugins'
  ],
  database: {
    dialect: 'sqlite',
    storage: './data/bot.db'
  }
})
```

### package.json

项目依赖和脚本：

```json
{
  "name": "my-bot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "zhin dev",
    "start": "zhin start",
    "build": "tsc",
    "stop": "zhin stop"
  },
  "dependencies": {
    "zhin.js": "^1.0.0"
  }
}
```

## 自定义模板

你可以使用自己的模板：

```bash
pnpm create zhin-app my-bot --template /path/to/template
```

模板目录应包含以下文件：

```
template/
├── template/              # 模板文件
│   ├── src/
│   ├── zhin.config.ts
│   └── ...
└── template.json          # 模板配置
```

### template.json

```json
{
  "name": "my-template",
  "description": "My custom template",
  "prompts": [
    {
      "name": "feature",
      "message": "Enable feature X?",
      "type": "confirm",
      "default": true
    }
  ]
}
```

## 示例项目

### 基础聊天机器人

```typescript
// src/index.ts
import { createApp, onMessage, addCommand, MessageCommand } from 'zhin.js'

const app = await createApp()

// 添加命令
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello, World!'
  }))

// 监听消息
onMessage(async (message) => {
  console.log('收到消息:', message.$content)
})
```

### 使用数据库

```typescript
// src/plugins/user-manager.ts
import { 
  defineModel, 
  Schema, 
  onDatabaseReady,
  onMessage 
} from 'zhin.js'

interface User {
  id: number
  username: string
  createdAt: Date
}

onDatabaseReady((db) => {
  const UserModel = defineModel<User>('User', new Schema({
    id: Schema.number().primary(),
    username: Schema.string().required(),
    createdAt: Schema.date().default(() => new Date())
  }))
  
  onMessage(async (message) => {
    if (message.$content === '/users') {
      const users = await UserModel.select().execute()
      await message.$reply(`共有 ${users.length} 个用户`)
    }
  })
})
```

## 环境变量

创建 `.env` 文件来存储敏感配置：

```env
# 机器人配置
BOT_TOKEN=your_token_here

# 数据库配置
DB_HOST=localhost
DB_PORT=3306

# 其他配置
NODE_ENV=development
LOG_LEVEL=debug
```

## 常见问题

### 如何添加新的适配器？

1. 安装适配器包：

```bash
pnpm add @zhin.js/adapter-discord
```

2. 在配置中添加：

```typescript
export default defineConfig({
  plugins: [
    'adapter-discord'
  ],
  bots: [
    {
      name: 'discord-bot',
      context: 'discord',
      token: process.env.DISCORD_TOKEN
    }
  ]
})
```

### 如何创建自定义插件？

在 `src/plugins/` 目录下创建新文件：

```typescript
// src/plugins/my-plugin.ts
import { onMessage, onMounted } from 'zhin.js'

onMounted(() => {
  console.log('插件已加载')
})

onMessage(async (message) => {
  // 处理消息
})
```

### 如何部署到生产环境？

1. 构建项目：

```bash
pnpm build
```

2. 设置环境变量：

```bash
export NODE_ENV=production
```

3. 启动：

```bash
pnpm start
```

或使用守护进程：

```bash
pnpm daemon
```

## 相关资源

- [Zhin.js 文档](https://docs.zhin.dev)
- [快速开始指南](https://docs.zhin.dev/guide/getting-started)
- [插件开发](https://docs.zhin.dev/plugin/getting-started)
- [GitHub 仓库](https://github.com/zhinjs/zhin)

## 许可证

MIT License
