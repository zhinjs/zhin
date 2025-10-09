# 🧠 基本概念

理解 Zhin.js 的核心概念和设计思想。

## 🎯 核心概念

### 1. 应用 (App)
应用是 Zhin 框架的顶层实例，负责协调所有组件。

```typescript
import { createApp } from 'zhin.js'

const app = await createApp()
await app.start()
```

### 2. 适配器 (Adapter)
适配器连接不同的聊天平台，提供统一的消息接口。

```typescript
// 控制台适配器
{ name: 'console-bot', context: 'process' }

// QQ 适配器
{ name: 'qq-bot', context: 'icqq', uin: 123456789 }
```

### 3. 插件 (Plugin)
插件是功能模块，通过插件系统扩展机器人功能。

```typescript
// 在 src/plugins/my-plugin.ts
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello')
  .action(() => 'Hello World!')
)
```

### 4. 上下文 (Context)
上下文是依赖注入系统，用于管理服务和服务间依赖。

```typescript
import { register, useContext } from 'zhin.js'

// 注册服务
register({
  name: 'database',
  async mounted() {
    return new Database()
  }
})

// 使用服务
useContext('database', (db) => {
  // 数据库就绪后执行
})
```

## 🏗️ 架构设计

### 四层架构
```
┌─────────────────┐
│   App 应用层     │  ← 应用入口和协调
├─────────────────┤
│   HMR 热更新层   │  ← 热重载和模块管理
├─────────────────┤
│ Dependency 依赖层│  ← 依赖注入和生命周期
├─────────────────┤
│  Plugin 插件层   │  ← 业务逻辑和消息处理
└─────────────────┘
```

### 消息流程
```
用户消息 → 适配器 → 消息转换 → 插件处理 → 回复消息 → 适配器 → 用户
```

## 🔄 生命周期

### 应用生命周期
1. **初始化** - 加载配置和依赖
2. **启动** - 启动适配器和插件
3. **运行** - 处理消息和事件
4. **停止** - 清理资源和关闭连接

### 插件生命周期
1. **加载** - 加载插件代码
2. **挂载** - 初始化插件资源
3. **运行** - 处理消息和事件
4. **卸载** - 清理插件资源

## 🧩 依赖注入

### 注册服务
```typescript
register({
  name: 'my-service',
  description: '我的服务',
  async mounted(plugin) {
    // 初始化逻辑
    return serviceInstance
  },
  async dispose(service) {
    // 清理逻辑
  }
})
```

### 使用服务
```typescript
useContext('my-service', (service) => {
  // 服务就绪后执行
  addCommand(new MessageCommand('test')
    .action(() => service.doSomething())
  )
})
```

## 📡 事件系统

### 消息事件
```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  console.log('收到消息:', message.raw)
})
```

### 生命周期事件
```typescript
import { onMounted, onDispose } from 'zhin.js'

onMounted(() => {
  console.log('插件已挂载')
})

onDispose(() => {
  console.log('插件已卸载')
})
```

## 🎨 消息处理

### 消息对象
```typescript
interface Message {
  id: string                    // 消息 ID
  adapter: string               // 适配器名称
  bot: string                   // 机器人名称
  content: MessageSegment[]     // 消息段数组
  sender: MessageSender         // 发送者信息
  channel: MessageChannel       // 频道信息
  timestamp: number             // 时间戳
  raw: string                   // 原始消息内容
  reply(content: SendContent, quote?: boolean|string): Promise<void>
}
```

### 命令处理
```typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    const { name } = result.args
    return `Hello, ${name}!`
  })
)
```

## 🔧 中间件系统

### 添加中间件
```typescript
import { addMiddleware } from 'zhin.js'

addMiddleware(async (message, next) => {
  console.log('处理消息前:', message.raw)
  await next()
  console.log('处理消息后')
})
```

## 🌐 跨平台支持

### 统一消息接口
所有适配器都提供统一的消息接口，插件无需关心具体平台。

### 平台特定功能
```typescript
onMessage(async (message) => {
  if (message.adapter === 'icqq') {
    // QQ 特有功能
  } else if (message.adapter === 'kook') {
    // KOOK 特有功能
  }
})
```

## 🔗 相关链接

- [项目结构](./project-structure.md)
- [配置说明](./configuration.md)
- [快速开始](./quick-start.md)
