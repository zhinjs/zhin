# ⚙️ 配置说明

Zhin.js 的配置系统支持多种格式和灵活的配置方式。

## 🎯 配置文件格式

### TypeScript 配置（推荐）
```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'my-bot',
        context: 'process'
      }
    ],
    plugin_dirs: ['./src/plugins', 'node_modules', 'node_modules/@zhin.js'],
    plugins: ['adapter-process', 'http'],
    debug: env.DEBUG === 'true'
  }
})
```

### JavaScript 配置
```javascript
// zhin.config.js
const { defineConfig } = require('zhin.js')

module.exports = defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'my-bot',
        context: 'process'
      }
    ],
    plugins: ['adapter-process', 'http']
  }
})
```

### JSON 配置
```json
{
  "bots": [
    {
      "name": "my-bot",
      "context": "process"
    }
  ],
  "plugins": ["adapter-process", "http"]
}
```

## 🔧 配置选项

### 基础配置
```typescript
interface AppConfig {
  bots?: BotConfig[]           // 机器人配置列表
  plugin_dirs?: string[]      // 插件目录列表
  plugins?: string[]          // 启用的插件列表
  disable_dependencies?: string[]  // 禁用的依赖列表
  debug?: boolean            // 调试模式
}

// 插件目录说明：
// - './src/plugins': 项目自定义插件目录
// - 'node_modules': 第三方 npm 插件目录
// - 'node_modules/@zhin.js': Zhin 官方插件目录（推荐）
```

### 机器人配置
```typescript
interface BotConfig {
  name: string               // 机器人名称
  context: string           // 适配器上下文名
  [key: string]: any        // 其他适配器特定配置
}
```

## 🌍 环境变量

### 基础环境变量
```bash
# .env
NODE_ENV=development
DEBUG=true
BOT_NAME=MyBot
```

### 适配器环境变量
```bash
# QQ 机器人
QQ_UIN=123456789
QQ_PASSWORD=your_password

# KOOK 机器人
KOOK_TOKEN=Bot_your_token

# OneBot
ONEBOT_WS_URL=ws://localhost:8080/ws
ACCESS_TOKEN=your_token
```

## 🔌 适配器配置

### Process 适配器
```typescript
{
  name: 'console-bot',
  context: 'process'
}
```

### ICQQ 适配器
```typescript
{
  name: 'qq-bot',
  context: 'icqq',
  uin: 123456789,
  password: 'your_password',
  platform: 4
}
```

### KOOK 适配器
```typescript
{
  name: 'kook-bot',
  context: 'kook',
  token: 'Bot_your_token',
  mode: 'websocket'
}
```

## 🧩 插件配置

### 基础插件配置
```typescript
plugins: [
  'adapter-process',  // 控制台适配器
  'http',            // HTTP 服务器
  'console'          // Web 控制台
]
```

### 高级插件配置
```typescript
plugins: [
  {
    name: 'http',
    config: {
      port: 8086,  // 默认端口（可自定义）
      auth: {
        username: 'admin',
        password: 'secret'
      }
    }
  },
  {
    name: 'console',
    config: {
      title: 'My Bot Console',
      theme: 'dark'
    }
  }
]
```

## 🔄 动态配置

### 基于环境的配置
```typescript
export default defineConfig(async (env) => {
  const isDev = env.NODE_ENV === 'development'
  
  return {
    bots: [
      // 开发环境使用控制台
      ...(isDev ? [{
        name: 'dev-bot',
        context: 'process'
      }] : []),
      
      // 生产环境使用真实适配器
      ...(env.QQ_UIN ? [{
        name: 'qq-bot',
        context: 'icqq',
        uin: parseInt(env.QQ_UIN)
      }] : [])
    ],
    
    plugins: [
      'adapter-process',
      ...(isDev ? [] : ['adapter-icqq']),
      'http',
      'console'
    ],
    
    debug: isDev
  }
})
```

## 📝 配置验证

### 使用 Zod 验证
```typescript
import { z } from 'zod'

const ConfigSchema = z.object({
  bots: z.array(z.object({
    name: z.string(),
    context: z.string()
  })),
  plugins: z.array(z.string()),
  debug: z.boolean().optional()
})

export default defineConfig(async (env) => {
  const config = {
    bots: [{ name: 'my-bot', context: 'process' }],
    plugins: ['adapter-process'],
    debug: env.DEBUG === 'true'
  }
  
  return ConfigSchema.parse(config)
})
```

## 🔗 相关链接

- [项目结构](./project-structure.md)
- [基本概念](./concepts.md)
- [快速开始](./quick-start.md)
