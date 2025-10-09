# 🔌 适配器开发指南

深入学习 Zhin.js 适配器开发的高级技巧和最佳实践。

## 🎯 适配器开发流程

### 1. 创建适配器文件
在 `adapters/` 目录下创建适配器文件。

```typescript
// adapters/my-platform/index.ts
import { Adapter, Bot, BotConfig, SendOptions } from 'zhin.js'

interface MyBotConfig extends BotConfig {
  name: string
  context: string
  token: string
  endpoint?: string
}

class MyBot implements Bot<MyBotConfig> {
  connected = false
  private client: any
  
  constructor(
    private plugin: Plugin,
    public config: MyBotConfig
  ) {}
  
  async connect() {
    // 实现连接逻辑
  }
  
  async disconnect() {
    // 实现断开逻辑
  }
  
  async sendMessage(options: SendOptions) {
    // 实现发送逻辑
  }
}

export class MyAdapter extends Adapter {
  constructor() {
    super('my-platform', (plugin, config) => new MyBot(plugin, config))
  }
}
```

### 2. 注册适配器
在插件中注册适配器。

```typescript
// src/plugins/adapter-my-platform.ts
import { registerAdapter } from 'zhin.js'
import { MyAdapter } from '../../adapters/my-platform'

registerAdapter(new MyAdapter())
```

### 3. 配置使用
在配置文件中使用适配器。

```typescript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'my-bot',
        context: 'my-platform',
        token: env.MY_PLATFORM_TOKEN
      }
    ],
    plugins: [
      'adapter-my-platform'
    ]
  }
})
```

## 🏗️ 适配器架构设计

### 分层架构
将适配器分为多个层次。

```typescript
// adapters/my-platform/
// ├── index.ts              # 主入口
// ├── adapter.ts            # 适配器类
// ├── bot.ts               # Bot 实现
// ├── client.ts            # 平台客户端
// ├── message-converter.ts  # 消息转换器
// └── types.ts             # 类型定义

// types.ts
export interface MyPlatformMessage {
  id: string
  content: string
  author: {
    id: string
    name: string
  }
  channel: {
    id: string
    type: 'text' | 'voice'
  }
}

export interface MyPlatformConfig {
  token: string
  endpoint: string
  options?: {
    reconnect?: boolean
    timeout?: number
  }
}
```

### 客户端抽象
创建平台客户端的抽象层。

```typescript
// client.ts
export abstract class PlatformClient {
  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract sendMessage(channel: string, content: string): Promise<void>
  abstract on(event: string, listener: Function): void
}

export class MyPlatformClient extends PlatformClient {
  private ws?: WebSocket
  
  async connect() {
    this.ws = new WebSocket(this.config.endpoint)
    // 实现连接逻辑
  }
  
  async disconnect() {
    if (this.ws) {
      this.ws.close()
    }
  }
  
  async sendMessage(channel: string, content: string) {
    if (!this.ws) throw new Error('Not connected')
    
    this.ws.send(JSON.stringify({
      type: 'message',
      channel,
      content
    }))
  }
  
  on(event: string, listener: Function) {
    if (this.ws) {
      this.ws.addEventListener(event, listener)
    }
  }
}
```

## 🔧 消息处理

### 消息转换器
实现消息格式转换。

```typescript
// message-converter.ts
export class MessageConverter {
  static toZhinMessage(platformMsg: MyPlatformMessage): Message {
    return {
      id: platformMsg.id,
      adapter: 'my-platform',
      bot: 'my-bot',
      content: this.parseContent(platformMsg.content),
      sender: {
        id: platformMsg.author.id,
        name: platformMsg.author.name
      },
      channel: {
        id: platformMsg.channel.id,
        type: platformMsg.channel.type === 'text' ? 'group' : 'private'
      },
      timestamp: Date.now(),
      raw: platformMsg.content,
      reply: async (content: string) => {
        // 实现回复逻辑
      }
    }
  }
  
  static toPlatformMessage(zhinMsg: SendOptions): any {
    return {
      channel: zhinMsg.id,
      content: zhinMsg.content,
      type: zhinMsg.type
    }
  }
  
  private static parseContent(content: string): MessageSegment[] {
    // 解析消息内容为消息段
    return [{ type: 'text', data: { text: content } }]
  }
}
```

### 事件处理
处理平台特定的事件。

```typescript
// bot.ts
export class MyBot implements Bot<MyBotConfig> {
  private setupEventHandlers() {
    this.client.on('message', this.handleMessage.bind(this))
    this.client.on('error', this.handleError.bind(this))
    this.client.on('disconnect', this.handleDisconnect.bind(this))
  }
  
  private handleMessage(platformMsg: MyPlatformMessage) {
    const message = MessageConverter.toZhinMessage(platformMsg)
    this.plugin.emit('message.receive', message)
  }
  
  private handleError(error: any) {
    this.plugin.logger.error('平台错误:', error)
    
    if (this.shouldReconnect(error)) {
      this.reconnect()
    }
  }
  
  private handleDisconnect() {
    this.connected = false
    this.plugin.logger.warn('连接已断开')
    
    if (this.config.options?.reconnect) {
      setTimeout(() => this.connect(), 5000)
    }
  }
}
```

## 🔄 连接管理

### 自动重连
实现自动重连机制。

```typescript
export class MyBot implements Bot<MyBotConfig> {
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 5000
  
  private async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.plugin.logger.error('重连次数超限，停止重连')
      return
    }
    
    this.reconnectAttempts++
    this.plugin.logger.info(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    
    try {
      await this.disconnect()
      await new Promise(resolve => setTimeout(resolve, this.reconnectDelay))
      await this.connect()
      this.reconnectAttempts = 0
    } catch (error) {
      this.plugin.logger.error('重连失败:', error)
      setTimeout(() => this.reconnect(), this.reconnectDelay)
    }
  }
  
  private shouldReconnect(error: any): boolean {
    // 判断是否应该重连
    return error.code === 'ECONNRESET' || error.code === 'ENOTFOUND'
  }
}
```

### 心跳检测
实现心跳检测机制。

```typescript
export class MyBot implements Bot<MyBotConfig> {
  private heartbeatInterval?: NodeJS.Timeout
  private lastHeartbeat = Date.now()
  
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.client && this.connected) {
        this.client.ping()
        this.lastHeartbeat = Date.now()
      }
    }, 30000) // 30秒心跳
  }
  
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
  }
  
  private checkHeartbeat() {
    const now = Date.now()
    if (now - this.lastHeartbeat > 60000) { // 1分钟无心跳
      this.plugin.logger.warn('心跳超时，尝试重连')
      this.reconnect()
    }
  }
}
```

## 🔧 配置管理

### 配置验证
使用 Zod 验证配置。

```typescript
import { z } from 'zod'

const MyPlatformConfigSchema = z.object({
  name: z.string().min(1),
  context: z.string().min(1),
  token: z.string().min(1),
  endpoint: z.string().url(),
  options: z.object({
    reconnect: z.boolean().default(true),
    timeout: z.number().min(1000).default(5000),
    heartbeat: z.number().min(1000).default(30000)
  }).default({})
})

export class MyBot implements Bot {
  private validatedConfig: z.infer<typeof MyPlatformConfigSchema>
  
  constructor(plugin: Plugin, config: any) {
    this.validatedConfig = MyPlatformConfigSchema.parse(config)
    this.plugin = plugin
  }
}
```

### 环境变量支持
支持通过环境变量配置。

```typescript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    bots: [
      {
        name: 'my-bot',
        context: 'my-platform',
        token: env.MY_PLATFORM_TOKEN,
        endpoint: env.MY_PLATFORM_ENDPOINT || 'wss://api.myplatform.com/ws',
        options: {
          reconnect: env.MY_PLATFORM_RECONNECT !== 'false',
          timeout: parseInt(env.MY_PLATFORM_TIMEOUT || '5000')
        }
      }
    ]
  }
})
```

## 📊 性能优化

### 连接池
实现连接池管理。

```typescript
export class ConnectionPool {
  private connections = new Map<string, WebSocket>()
  private maxConnections = 10
  
  async getConnection(key: string): Promise<WebSocket> {
    if (this.connections.has(key)) {
      return this.connections.get(key)!
    }
    
    if (this.connections.size >= this.maxConnections) {
      throw new Error('连接池已满')
    }
    
    const connection = await this.createConnection(key)
    this.connections.set(key, connection)
    return connection
  }
  
  private async createConnection(key: string): Promise<WebSocket> {
    // 创建连接的逻辑
  }
}
```

### 消息队列
实现消息队列处理。

```typescript
export class MessageQueue {
  private queue: Array<{ message: any; resolve: Function; reject: Function }> = []
  private processing = false
  
  async enqueue(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ message, resolve, reject })
      this.process()
    })
  }
  
  private async process() {
    if (this.processing || this.queue.length === 0) return
    
    this.processing = true
    
    while (this.queue.length > 0) {
      const { message, resolve, reject } = this.queue.shift()!
      
      try {
        await this.sendMessage(message)
        resolve()
      } catch (error) {
        reject(error)
      }
    }
    
    this.processing = false
  }
}
```

## 🧪 测试适配器

### 单元测试
测试适配器的各个组件。

```typescript
// tests/adapter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MyAdapter, MyBot } from '../src/adapter'

describe('MyAdapter', () => {
  let adapter: MyAdapter
  let mockPlugin: any
  
  beforeEach(() => {
    mockPlugin = {
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
      },
      emit: vi.fn()
    }
    
    adapter = new MyAdapter()
  })
  
  it('should create bot instance', () => {
    const config = {
      name: 'test-bot',
      context: 'my-platform',
      token: 'test-token'
    }
    
    const bot = adapter.createBot(mockPlugin, config)
    expect(bot).toBeInstanceOf(MyBot)
    expect(bot.config).toEqual(config)
  })
  
  it('should handle connection success', async () => {
    const bot = adapter.createBot(mockPlugin, {
      name: 'test-bot',
      context: 'my-platform',
      token: 'valid-token'
    })
    
    await bot.connect()
    expect(bot.connected).toBe(true)
  })
})
```

### 集成测试
测试适配器与框架的集成。

```typescript
describe('Adapter Integration', () => {
  it('should work with Zhin framework', async () => {
    const app = await createApp({
      bots: [
        {
          name: 'test-bot',
          context: 'my-platform',
          token: 'test-token'
        }
      ],
      plugins: ['adapter-my-platform']
    })
    
    await app.start()
    
    // 验证适配器是否正确加载
    expect(app.getContext('my-platform')).toBeDefined()
  })
})
```

## 🔗 相关链接

- [适配器 API](../api/adapter.md)
- [Bot 接口实现](./bot-interface.md)
- [消息处理](./message-handling.md)
- [事件处理](./event-handling.md)
