# 📡 事件系统

Zhin.js 的事件系统 API 参考文档。

## 🎯 事件系统概述

Zhin.js 基于 Node.js EventEmitter 构建了强大的事件系统，支持消息事件、生命周期事件和自定义事件。

## 💬 消息事件

### onMessage
监听所有消息事件。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  console.log('收到消息:', message.raw)
  console.log('发送者:', message.sender.name)
  console.log('频道:', message.channel.id)
})
```

### 消息类型过滤
根据消息类型进行过滤处理。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  // 群消息处理
  if (message.channel.type === 'group') {
    console.log('群消息:', message.raw)
  }
  
  // 私聊消息处理
  if (message.channel.type === 'private') {
    console.log('私聊消息:', message.raw)
  }
})
```

### 适配器特定处理
根据适配器类型进行特定处理。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  switch (message.adapter) {
    case 'icqq':
      // QQ 特有处理
      if (message.content.some(seg => seg.type === 'at')) {
        await message.reply('有人@我了！')
      }
      break
      
    case 'kook':
      // KOOK 特有处理
      if (message.channel.type === 'channel') {
        await message.reply('频道消息')
      }
      break
      
    case 'onebot11':
      // OneBot 标准处理
      await message.reply('OneBot 消息')
      break
  }
})
```

## 🔄 生命周期事件

### onMounted
插件挂载完成时触发。

```typescript
import { onMounted } from 'zhin.js'

onMounted(() => {
  console.log('插件已挂载，所有依赖已就绪')
  
  // 可以安全使用其他服务
  const db = useContext('database')
  console.log('数据库已就绪:', db)
})
```

### onDispose
插件销毁时触发。

```typescript
import { onDispose } from 'zhin.js'

let resources: any[] = []

onMounted(() => {
  // 初始化资源
  resources.push(createResource1())
  resources.push(createResource2())
})

onDispose(() => {
  // 清理资源
  resources.forEach(resource => resource.cleanup())
  resources = []
  console.log('插件资源已清理')
})
```

## 🎨 自定义事件

### 事件监听
使用插件实例监听自定义事件。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()

// 监听自定义事件
plugin.on('user-login', (userData) => {
  console.log('用户登录:', userData)
})

plugin.on('data-updated', (data) => {
  console.log('数据已更新:', data)
})
```

### 事件触发
触发自定义事件。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()

// 触发事件
plugin.emit('user-login', { userId: '123', username: 'john' })
plugin.emit('data-updated', { table: 'users', count: 100 })
```

### 事件数据传递
传递复杂的事件数据。

```typescript
interface UserLoginEvent {
  userId: string
  username: string
  timestamp: number
  ip: string
}

plugin.on('user-login', (event: UserLoginEvent) => {
  console.log(`用户 ${event.username} 在 ${new Date(event.timestamp)} 登录`)
})

// 触发事件
plugin.emit('user-login', {
  userId: '123',
  username: 'john',
  timestamp: Date.now(),
  ip: '192.168.1.1'
})
```

## 🔧 事件中间件

### 全局事件中间件
为所有事件添加中间件。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()

// 添加全局事件中间件
plugin.on('message.receive', (message) => {
  console.log(`[${new Date().toISOString()}] 收到消息: ${message.raw}`)
})

plugin.on('message.send', (message) => {
  console.log(`[${new Date().toISOString()}] 发送消息: ${message.content}`)
})
```

### 事件过滤
根据条件过滤事件。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  // 只处理包含特定关键词的消息
  if (message.raw.includes('重要')) {
    console.log('重要消息:', message.raw)
  }
  
  // 只处理特定用户的消息
  if (message.sender.id === 'admin') {
    console.log('管理员消息:', message.raw)
  }
})
```

## 📊 事件统计

### 事件计数器
统计事件触发次数。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()
const eventStats = new Map<string, number>()

// 监听所有事件并统计
plugin.on('*', (eventName) => {
  const count = eventStats.get(eventName) || 0
  eventStats.set(eventName, count + 1)
})

// 获取统计信息
function getEventStats() {
  return Object.fromEntries(eventStats)
}
```

### 性能监控
监控事件处理性能。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  const start = Date.now()
  
  try {
    // 处理消息
    await processMessage(message)
  } finally {
    const duration = Date.now() - start
    console.log(`消息处理耗时: ${duration}ms`)
    
    // 记录慢处理
    if (duration > 1000) {
      console.warn(`慢消息处理: ${message.raw} (${duration}ms)`)
    }
  }
})
```

## 🔗 事件链

### 事件链式处理
创建事件处理链。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  // 第一层：权限检查
  if (!hasPermission(message.sender.id)) {
    return
  }
  
  // 第二层：内容过滤
  if (containsSpam(message.raw)) {
    return
  }
  
  // 第三层：业务处理
  await handleBusinessLogic(message)
})
```

### 事件优先级
使用事件优先级控制处理顺序。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()

// 高优先级事件（先处理）
plugin.prependListener('message.receive', (message) => {
  console.log('高优先级处理')
})

// 低优先级事件（后处理）
plugin.on('message.receive', (message) => {
  console.log('低优先级处理')
})
```

## 🛠️ 事件工具

### 事件防抖
防止事件过于频繁触发。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()
const debounceMap = new Map<string, NodeJS.Timeout>()

function debounceEvent(eventName: string, callback: Function, delay: number) {
  const existingTimeout = debounceMap.get(eventName)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
  }
  
  const timeout = setTimeout(() => {
    callback()
    debounceMap.delete(eventName)
  }, delay)
  
  debounceMap.set(eventName, timeout)
}

// 使用防抖
plugin.on('data-change', (data) => {
  debounceEvent('data-change', () => {
    console.log('数据已更新:', data)
  }, 1000)
})
```

### 事件节流
限制事件触发频率。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()
const throttleMap = new Map<string, boolean>()

function throttleEvent(eventName: string, callback: Function, delay: number) {
  if (throttleMap.get(eventName)) {
    return
  }
  
  throttleMap.set(eventName, true)
  callback()
  
  setTimeout(() => {
    throttleMap.set(eventName, false)
  }, delay)
}

// 使用节流
plugin.on('user-activity', (activity) => {
  throttleEvent('user-activity', () => {
    console.log('用户活动:', activity)
  }, 5000)
})
```

## 🔗 相关链接

- [核心 API](./core.md)
- [插件 API](./plugin.md)
- [适配器 API](./adapter.md)
- [类型定义](./types.md)
