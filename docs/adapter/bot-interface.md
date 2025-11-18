# 🤖 Bot 接口实现

深入了解 Zhin.js Bot 接口的实现细节。

## 🎯 Bot 接口概述

Bot 接口是适配器的核心组件，负责与特定聊天平台的通信。

## 🔧 基础接口

### Bot 基类
```typescript
interface Bot<T extends BotConfig = BotConfig> {
  connected: boolean
  config: T
  
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(options: SendOptions): Promise<void>
}
```

### 实现示例
```typescript
class MyBot implements Bot<MyBotConfig> {
  public connected = false
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
```

## 🔗 连接管理

### 连接状态
管理 Bot 的连接状态。

```typescript
class MyBot implements Bot {
  private _connected = false
  
  get connected(): boolean {
    return this._connected
  }
  
  private setConnected(value: boolean) {
    this._connected = value
    this.plugin.emit('bot.connection.changed', { connected: value })
  }
  
  async connect() {
    try {
      await this.establishConnection()
      this.setConnected(true)
      this.plugin.logger.info('Bot 连接成功')
    } catch (error) {
      this.plugin.logger.error('Bot 连接失败:', error)
      throw error
    }
  }
  
  async disconnect() {
    try {
      await this.closeConnection()
      this.setConnected(false)
      this.plugin.logger.info('Bot 已断开连接')
    } catch (error) {
      this.plugin.logger.error('Bot 断开连接失败:', error)
    }
  }
}
```

### 重连机制
实现自动重连功能。

```typescript
class MyBot implements Bot {
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 5000
  private reconnectTimer?: NodeJS.Timeout
  
  async connect() {
    try {
      await this.establishConnection()
      this.setConnected(true)
      this.reconnectAttempts = 0
    } catch (error) {
      this.handleConnectionError(error)
    }
  }
  
  private handleConnectionError(error: any) {
    this.plugin.logger.error('连接错误:', error)
    
    if (this.shouldReconnect(error)) {
      this.scheduleReconnect()
    }
  }
  
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.plugin.logger.error('重连次数超限，停止重连')
      return
    }
    
    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    this.plugin.logger.info(`将在 ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }
  
  private shouldReconnect(error: any): boolean {
    // 判断是否应该重连
    return error.code === 'ECONNRESET' || 
           error.code === 'ENOTFOUND' ||
           error.message.includes('timeout')
  }
}
```

## 💬 消息处理

### 发送消息
实现消息发送功能。

```typescript
class MyBot implements Bot {
  async sendMessage(options: SendOptions) {
    if (!this.connected) {
      throw new Error('Bot 未连接')
    }
    
    try {
      const platformMessage = this.convertToPlatformFormat(options)
      await this.client.sendMessage(platformMessage)
      
      this.plugin.logger.debug('消息发送成功:', options)
    } catch (error) {
      this.plugin.logger.error('消息发送失败:', error)
      throw error
    }
  }
  
  private convertToPlatformFormat(options: SendOptions): any {
    return {
      channel: options.id,
      content: options.content,
      type: options.type
    }
  }
}
```

### 撤回消息
实现消息撤回功能（必须实现 $recallMessage 方法）。

```typescript
class MyBot implements Bot {
  async $recallMessage(messageId: string) {
    if (!this.connected) {
      throw new Error('Bot 未连接')
    }
    
    try {
      await this.client.deleteMessage(messageId)
      this.plugin.logger.debug('消息撤回成功:', messageId)
    } catch (error) {
      this.plugin.logger.error('消息撤回失败:', error)
      throw error
    }
  }
}
```

### 接收消息
处理接收到的消息。

```typescript
class MyBot implements Bot {
  private setupMessageHandlers() {
    this.client.on('message', this.handleMessage.bind(this))
  }
  
  private handleMessage(platformMessage: any) {
    try {
      const message = this.convertFromPlatformFormat(platformMessage)
      this.plugin.emit('message.receive', message)
    } catch (error) {
      this.plugin.logger.error('消息处理失败:', error)
    }
  }
  
  private convertFromPlatformFormat(platformMessage: any): Message {
    return {
      id: platformMessage.id,
      adapter: this.config.context,
      bot: this.config.name,
      content: this.parseContent(platformMessage.content),
      sender: {
        id: platformMessage.author.id,
        name: platformMessage.author.name
      },
      channel: {
        id: platformMessage.channel.id,
        type: this.mapChannelType(platformMessage.channel.type)
      },
      timestamp: platformMessage.timestamp || Date.now(),
      raw: platformMessage.content,
      reply: async (content: string) => {
        await this.sendMessage({
          context: this.config.context,
          bot: this.config.name,
          id: platformMessage.channel.id,
          type: platformMessage.channel.type,
          content
        })
      }
    }
  }
}
```

## 🔧 事件处理

### 事件监听
设置事件监听器。

```typescript
class MyBot implements Bot {
  private setupEventHandlers() {
    this.client.on('message', this.handleMessage.bind(this))
    this.client.on('error', this.handleError.bind(this))
    this.client.on('disconnect', this.handleDisconnect.bind(this))
    this.client.on('reconnect', this.handleReconnect.bind(this))
  }
  
  private handleError(error: any) {
    this.plugin.logger.error('Bot 错误:', error)
    this.plugin.emit('bot.error', error)
  }
  
  private handleDisconnect() {
    this.setConnected(false)
    this.plugin.emit('bot.disconnect')
  }
  
  private handleReconnect() {
    this.setConnected(true)
    this.plugin.emit('bot.reconnect')
  }
}
```

### 自定义事件
触发自定义事件。

```typescript
class MyBot implements Bot {
  private triggerCustomEvents(platformMessage: any) {
    // 根据消息类型触发不同事件
    if (platformMessage.type === 'group') {
      this.plugin.emit('message.group.receive', message)
    } else {
      this.plugin.emit('message.private.receive', message)
    }
    
    // 根据内容触发事件
    if (platformMessage.content.includes('@')) {
      this.plugin.emit('message.mention', message)
    }
  }
}
```

## 📊 性能监控

### 统计信息
收集 Bot 的统计信息。

```typescript
class MyBot implements Bot {
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    connectionUptime: Date.now(),
    lastActivity: Date.now()
  }
  
  async sendMessage(options: SendOptions) {
    const start = Date.now()
    
    try {
      await this.client.sendMessage(options)
      this.stats.messagesSent++
      this.stats.lastActivity = Date.now()
      
      const duration = Date.now() - start
      this.plugin.logger.debug(`消息发送成功 (${duration}ms)`)
      
    } catch (error) {
      this.stats.errors++
      throw error
    }
  }
  
  private handleMessage(platformMessage: any) {
    this.stats.messagesReceived++
    this.stats.lastActivity = Date.now()
    
    // 处理消息...
  }
  
  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.connectionUptime,
      lastActivityAgo: Date.now() - this.stats.lastActivity
    }
  }
}
```

### 健康检查
实现健康检查功能。

```typescript
class MyBot implements Bot {
  private healthCheckInterval?: NodeJS.Timeout
  
  private startHealthCheck() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck()
    }, 30000) // 30秒检查一次
  }
  
  private performHealthCheck() {
    if (!this.connected) {
      this.plugin.logger.warn('Bot 未连接，尝试重连')
      this.connect()
      return
    }
    
    const lastActivity = Date.now() - this.stats.lastActivity
    if (lastActivity > 300000) { // 5分钟无活动
      this.plugin.logger.warn('Bot 长时间无活动，检查连接')
      this.checkConnection()
    }
  }
  
  private async checkConnection() {
    try {
      await this.client.ping()
    } catch (error) {
      this.plugin.logger.warn('连接检查失败，尝试重连')
      this.connect()
    }
  }
}
```

## 🔗 相关链接

- [适配器开发指南](./development.md)
- [消息处理](./message-handling.md)
- [事件处理](./event-handling.md)
