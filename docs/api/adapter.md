# 🔌 适配器 API

Zhin.js 适配器开发相关的 API 参考文档。

## 🎯 适配器核心 API

### registerAdapter
注册适配器。

```typescript
import { registerAdapter } from 'zhin.js'
import { MyAdapter } from './my-adapter'

registerAdapter(new MyAdapter())
```

### Adapter 基类
适配器基类，提供适配器的基础功能。

```typescript
import { Adapter } from 'zhin.js'

export class MyAdapter extends Adapter {
  constructor() {
    super('my-platform', (plugin, config) => new MyBot(plugin, config))
  }
  
  async start() {
    await super.start()
    this.plugin.logger.info(`${this.name} 适配器启动完成`)
  }
  
  async stop() {
    await super.stop()
    this.plugin.logger.info(`${this.name} 适配器已停止`)
  }
}
```

## 🤖 Bot 接口

### Bot 基类
Bot 实例基类，提供机器人实例的基础功能。

```typescript
import { Bot, BotConfig, SendOptions } from 'zhin.js'

interface MyBotConfig extends BotConfig {
  name: string
  context: string
  token: string
  endpoint?: string
}

class MyBot implements Bot<MyBotConfig> {
  public connected = false
  private client: any
  
  constructor(
    private plugin: Plugin,
    public config: MyBotConfig
  ) {}
  
  async connect() {
    // 建立连接
    this.client = await this.createConnection()
    this.connected = true
  }
  
  async disconnect() {
    // 断开连接
    if (this.client) {
      await this.client.disconnect()
    }
    this.connected = false
  }
  
  async sendMessage(options: SendOptions) {
    // 发送消息
    if (!this.connected) {
      throw new Error('机器人未连接')
    }
    
    const platformMessage = this.convertToPlatformFormat(options)
    await this.client.sendMessage(platformMessage)
  }
}
```

## 📡 消息处理

### 消息转换
将 Zhin 消息格式转换为平台特定格式。

```typescript
private convertToPlatformFormat(options: SendOptions) {
  return {
    channel: options.id,
    content: options.content,
    type: options.type
  }
}

private convertFromPlatformFormat(rawMessage: any) {
  return {
    id: rawMessage.id,
    adapter: this.config.context,
    bot: this.config.name,
    content: this.parseContent(rawMessage.content),
    sender: {
      id: rawMessage.author.id,
      name: rawMessage.author.name
    },
    channel: {
      id: rawMessage.channel.id,
      type: rawMessage.channel.type
    },
    timestamp: rawMessage.timestamp,
    raw: rawMessage.content,
    reply: async (content: string) => {
      await this.sendMessage({
        context: this.config.context,
        bot: this.config.name,
        id: rawMessage.channel.id,
        type: rawMessage.channel.type,
        content
      })
    }
  }
}
```

### 事件处理
处理平台特定的事件。

```typescript
private setupEventHandlers() {
  this.client.on('message', this.handleMessage.bind(this))
  this.client.on('error', this.handleError.bind(this))
  this.client.on('disconnect', this.handleDisconnect.bind(this))
}

private handleMessage(rawMessage: any) {
  const message = this.convertFromPlatformFormat(rawMessage)
  this.plugin.emit('message.receive', message)
}

private handleError(error: any) {
  this.plugin.logger.error('平台错误:', error)
  
  // 自动重连逻辑
  if (this.shouldReconnect(error)) {
    this.reconnect()
  }
}

private handleDisconnect() {
  this.connected = false
  this.plugin.logger.warn('连接已断开，尝试重连...')
  
  setTimeout(() => {
    if (!this.connected) {
      this.connect()
    }
  }, 5000)
}
```

## 🔧 配置管理

### 配置验证
使用 Zod 验证配置。

```typescript
import { z } from 'zod'

const BotConfigSchema = z.object({
  name: z.string().min(1),
  context: z.string().min(1),
  token: z.string().min(1),
  endpoint: z.string().url().optional(),
  options: z.object({
    reconnect: z.boolean().default(true),
    timeout: z.number().min(1000).default(5000)
  }).default({})
})

class MyBot implements Bot {
  private validatedConfig: z.infer<typeof BotConfigSchema>
  
  constructor(plugin: Plugin, config: any) {
    this.validatedConfig = BotConfigSchema.parse(config)
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
        endpoint: env.MY_PLATFORM_ENDPOINT
      }
    ]
  }
})
```

## 🔄 连接管理

### 自动重连
实现自动重连机制。

```typescript
class MyBot implements Bot {
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
}
```

### 心跳检测
实现心跳检测机制。

```typescript
class MyBot implements Bot {
  private heartbeatInterval?: NodeJS.Timeout
  
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.client && this.connected) {
        this.client.ping()
      }
    }, 30000) // 30秒心跳
  }
  
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
  }
}
```

## 📊 性能监控

### 统计信息
收集和报告统计信息。

```typescript
class MyBot implements Bot {
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    connectionUptime: Date.now()
  }
  
  async sendMessage(options: SendOptions) {
    const start = Date.now()
    
    try {
      await this.client.sendMessage(options)
      this.stats.messagesSent++
      
      const duration = Date.now() - start
      this.plugin.logger.debug(`消息发送成功 (${duration}ms)`)
      
    } catch (error) {
      this.stats.errors++
      throw error
    }
  }
  
  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.connectionUptime
    }
  }
}
```

## 🔗 相关链接

- [核心 API](./core.md)
- [插件 API](./plugin.md)
- [事件系统](./events.md)
- [类型定义](./types.md)
