# ⚙️ 配置说明

Zhin.js 的配置系统支持多种格式和灵活的配置方式。

## 🎯 配置文件格式

### TypeScript 配置（推荐）
```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig(async (env) => {
  return {
    // 数据库配置
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    
    // 机器人实例配置
    bots: [
      {
        name: 'console-bot',
        context: 'process'
      }
    ],
    
    // 日志级别：0=TRACE, 1=DEBUG, 2=INFO, 3=WARN, 4=ERROR
    log_level: 1,
    
    // 日志配置
    log: {
      maxDays: 7,
      maxRecords: 10000,
      cleanupInterval: 24
    },
    
    // 插件目录
    plugin_dirs: [
      './src/plugins', 
      'node_modules', 
      'node_modules/@zhin.js'
    ],
    
    // 启用的插件列表
    plugins: [
      'adapter-process',
      'http',
      'console'
    ],
    
    // 调试模式
    debug: env.DEBUG === 'true',
    
    // 插件配置
    'http': {
      port: 8086,
      auth: {
        username: 'admin',
        password: '123456'
      }
    }
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
  bots?: Bot.Config[]         // 机器人配置列表
  log_level: LogLevel         // 日志级别 (0-4)
  database?: DatabaseConfig   // 数据库配置
  plugin_dirs?: string[]      // 插件目录列表
  plugins?: string[]          // 启用的插件列表
  disable_dependencies?: string[]  // 禁用的依赖列表
  debug?: boolean            // 调试模式
  log?: {                    // 日志配置
    maxDays?: number;        // 最大日志保留天数，默认 7 天
    maxRecords?: number;     // 最大日志条数，默认 10000 条
    cleanupInterval?: number; // 自动清理间隔（小时），默认 24 小时
  };
  [key: string]: any;        // 插件配置（键为插件名）
}

// 插件目录说明：
// - './src/plugins': 项目自定义插件目录
// - 'node_modules': 第三方 npm 插件目录
// - 'node_modules/@zhin.js': Zhin 官方插件目录（推荐）
```

### 机器人配置
```typescript
interface Bot.Config {
  name: string               // 机器人名称
  context: string           // 适配器上下文名
  [key: string]: any        // 其他适配器特定配置
}
```

### 数据库配置
```typescript
interface DatabaseConfig {
  dialect: 'sqlite' | 'mysql' | 'postgres'  // 数据库类型
  // SQLite 配置
  filename?: string         // SQLite 数据库文件路径
  // MySQL/PostgreSQL 配置
  host?: string            // 数据库主机
  port?: number            // 数据库端口
  username?: string        // 用户名
  password?: string        // 密码
  database?: string        // 数据库名
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
# ICQQ 适配器
ICQQ_LOGIN_UIN=123456789
ONEBOT_TOKEN=your_password_or_empty_for_qrcode
ICQQ_SIGN_ADDR=http://localhost:8080  # 签名API地址（可选）

# KOOK 机器人
KOOK_TOKEN=Bot_your_token

# Discord 机器人
DISCORD_TOKEN=your_discord_token

# QQ 官方机器人
ZHIN_SECRET=your_qq_official_secret
ZHIN2_SECRET=your_another_bot_secret

# OneBot v11
ONEBOT_WS_URL=ws://localhost:8080/ws
ONEBOT_ACCESS_TOKEN=your_token
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
  name: '123456789',        // QQ 号
  context: 'icqq',
  password: 'your_password', // 密码或扫码登录时为空
  platform: 2,             // 1: 安卓手机, 2: 安卓手表, 3: MacOS, 4: 企点
  log_level: 'off',         // 日志级别
  data_dir: './data'        // 数据目录
}
```

### KOOK 适配器
```typescript
{
  name: 'kook-bot',
  context: 'kook',
  token: 'Bot_your_token',  // KOOK 机器人 Token
  mode: 'websocket',        // 连接模式
  logLevel: 'off',          // 日志级别
  ignore: 'bot'             // 忽略机器人消息
}
```

### Discord 适配器
```typescript
{
  name: 'discord-bot',
  context: 'discord',
  token: 'your_discord_token'  // Discord 机器人 Token
}
```

### QQ 官方适配器
```typescript
{
  name: 'qq-official',
  context: 'qq',
  appid: '102073979',       // QQ 开放平台应用 ID
  secret: 'your_secret',    // 应用密钥
  intents: [                // 订阅的事件类型
    'GUILDS',
    'GROUP_AT_MESSAGE_CREATE',
    'PUBLIC_GUILD_MESSAGES'
  ],
  sandbox: true,            // 是否沙箱环境
  mode: 'websocket'         // 连接模式
}
```

## 🧩 插件配置

### 插件列表配置

插件配置使用字符串数组，只需提供插件名称：

```typescript
export default defineConfig({
  // 插件列表 - 只支持字符串数组
  plugins: [
    'adapter-process',  // 控制台适配器
    'http',            // HTTP 服务器
    'console',         // Web 控制台
    'my-plugin'        // 自定义插件
  ]
})
```

### 插件配置参数

每个插件的具体配置通过配置对象的根级属性设置，使用插件名作为键：

```typescript
export default defineConfig({
  plugins: ['http', 'adapter-process', 'console', 'my-plugin'],
  
  // HTTP 插件配置
  http: {
    port: 8086,
    username: process.env.HTTP_USERNAME,
    password: process.env.HTTP_PASSWORD,
    base: '/api'
  },
  
  // Console 插件配置
  console: {
    title: 'My Bot Console',
    dev: true
  },
  
  // 自定义插件配置
  'my-plugin': {
    apiKey: process.env.API_KEY,
    timeout: 5000,
    retries: 3
  }
})
```

### 插件配置定义

插件开发者使用 `defineSchema` 定义配置结构：

```typescript
// plugins/my-plugin/src/index.ts
import { defineSchema, Schema, usePlugin } from '@zhin.js/core'

const plugin = usePlugin()

// 定义配置 Schema
defineSchema(Schema.object({
  apiKey: Schema.string('apiKey')
    .required()
    .description('API 访问密钥'),
  
  timeout: Schema.number('timeout')
    .default(5000)
    .min(1000)
    .max(30000)
    .description('请求超时时间（毫秒）'),
  
  retries: Schema.number('retries')
    .default(3)
    .min(0)
    .max(10)
    .description('失败重试次数')
}))

// 使用配置（支持默认值和解构）
const { 
  apiKey, 
  timeout = 5000, 
  retries = 3 
} = plugin.config

console.log(`API Key: ${apiKey}`)
console.log(`Timeout: ${timeout}ms`)
console.log(`Retries: ${retries}`)
```

### Schema 类型系统

Zhin.js 提供了丰富的 Schema 类型用于配置验证：

```typescript
defineSchema(Schema.object({
  // 基础类型
  name: Schema.string('name').default('default'),
  count: Schema.number('count').min(0).max(100),
  enabled: Schema.boolean('enabled').default(true),
  
  // 特殊类型
  ratio: Schema.percent('ratio').default(0.8),  // 0-1 之间
  createdAt: Schema.date('createdAt'),
  pattern: Schema.regexp('pattern'),
  
  // 集合类型
  tags: Schema.list(Schema.string()).default([]),
  coords: Schema.tuple([Schema.number(), Schema.number()]),
  
  // 嵌套对象
  database: Schema.object({
    host: Schema.string().default('localhost'),
    port: Schema.number().default(3306)
  }),
  
  // 联合类型
  timeout: Schema.union([
    Schema.string(),
    Schema.number()
  ]).default(5000),
  
  // 枚举
  logLevel: Schema.union([
    Schema.const('debug'),
    Schema.const('info'),
    Schema.const('warn'),
    Schema.const('error')
  ]).default('info')
}))
```

### Schema 验证方法

Schema 支持链式调用进行验证：

```typescript
defineSchema(Schema.object({
  // 数值验证
  port: Schema.number('port')
    .min(1024)              // 最小值
    .max(65535)             // 最大值
    .default(8086),
  
  // 字符串验证
  apiKey: Schema.string('apiKey')
    .required()             // 必填
    .pattern(/^sk-/)        // 正则验证
    .min(20)                // 最小长度
    .max(100),              // 最大长度
  
  // 描述信息（用于文档和 UI 生成）
  timeout: Schema.number('timeout')
    .description('请求超时时间（毫秒）')
    .default(5000)
}))
```

### 完整配置示例

参考 HTTP 插件的完整配置实现：

```typescript
// plugins/http/src/index.ts
import { defineSchema, Schema, usePlugin } from '@zhin.js/core'
import os from 'node:os'

const plugin = usePlugin()

// 辅助函数
const getCurrentUsername = () => {
  try {
    return os.userInfo().username
  } catch {
    return 'admin'
  }
}

const generateRandomPassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 定义 Schema
defineSchema(Schema.object({
  port: Schema.number('port')
    .default(8086)
    .description('HTTP 服务端口'),
  
  username: Schema.string('username')
    .description('HTTP 基本认证用户名, 默认为当前系统用户名'),
  
  password: Schema.string('password')
    .description('HTTP 基本认证密码, 默认为随机生成的6位字符串'),
  
  base: Schema.string('base')
    .default('/api')
    .description('HTTP 路由前缀, 默认为 /api')
}))

// 使用配置（支持默认值和计算值）
const { 
  port = 8086, 
  username = getCurrentUsername(), 
  password = generateRandomPassword(), 
  base = '/api' 
} = plugin.config

// 在配置文件中使用
// zhin.config.ts:
// export default defineConfig({
//   plugins: ['http'],
//   http: {
//     port: 8086,
//     username: process.env.HTTP_USERNAME,
//     password: process.env.HTTP_PASSWORD,
//     base: '/api'
//   }
// })
```

### Web 控制台配置管理

启动应用后，访问 Web 控制台可视化管理配置：

1. 访问 `http://localhost:8086/`
2. 进入插件管理页面
3. 选择要配置的插件
4. 在配置面板中修改配置项
5. 保存后自动更新配置文件

Web 控制台会根据 Schema 定义自动生成表单控件：

| Schema 类型 | UI 控件 |
|------------|---------|
| `string` | 文本框 / 文本域 / 下拉选择 |
| `number` | 数字输入框（带范围限制） |
| `boolean` | 开关 |
| `percent` | 滑块 + 数字输入 |
| `date` | 日期选择器 |
| `list` | 动态列表 |
| `object` | 嵌套表单 |
| `union` | 下拉选择 / 单选按钮 |

## 🔄 动态配置

### 基于环境的配置
```typescript
export default defineConfig(async (env) => {
  const isDev = env.NODE_ENV === 'development'
  
  return {
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    
    bots: [
      // 开发环境使用控制台
      {
        name: 'dev-bot',
        context: 'process'
      },
      
      // 如果配置了 KOOK Token，启用 KOOK 机器人
      ...(env.KOOK_TOKEN ? [{
        name: 'kook-bot',
        context: 'kook',
        token: env.KOOK_TOKEN,
        mode: 'websocket'
      }] : []),
      
      // 如果配置了 QQ 相关信息，启用 ICQQ 机器人
      ...(env.ICQQ_LOGIN_UIN ? [{
        name: env.ICQQ_LOGIN_UIN,
        context: 'icqq',
        password: env.ONEBOT_TOKEN,
        platform: 2,
        data_dir: './data'
      }] : [])
    ],
    
    log_level: isDev ? 1 : 2,  // 开发环境详细日志，生产环境简洁日志
    
    plugins: [
      'adapter-process',
      ...(env.KOOK_TOKEN ? ['adapter-kook'] : []),
      ...(env.ICQQ_LOGIN_UIN ? ['adapter-icqq'] : []),
      'http',
      'console'
    ],
    
    debug: isDev,
    
    // HTTP 服务配置
    'http': {
      port: parseInt(env.HTTP_PORT) || 8086
    }
  }
})
```

## 📝 配置验证

### 使用内置 Schema 验证

Zhin.js 使用内置的 Schema 系统进行配置验证，无需额外依赖：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig(async (env) => {
  return {
    bots: [{ name: 'my-bot', context: 'process' }],
    plugins: ['adapter-process', 'http'],
    log_level: 1,
    debug: env.DEBUG === 'true'
  }
})
```

配置会自动通过内置 Schema 进行验证，确保类型安全。
```

## 🔗 相关链接

- [项目结构](./project-structure.md)
- [基本概念](./concepts.md)
- [快速开始](./quick-start.md)
