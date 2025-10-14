# @zhin.js/http

Zhin 机器人框架的 HTTP 服务插件，提供 HTTP/WebSocket 服务器和路由管理。

## 特性

- 🌐 **HTTP 服务器** - 基于 Koa 的 HTTP 服务
- 🔌 **WebSocket 支持** - 内置 WebSocket 服务器
- 🛣️ **路由管理** - 强大的路由系统
- 🔐 **基础认证** - 内置 HTTP Basic Auth
- 📊 **API 接口** - 系统状态、健康检查、统计信息等
- 🎯 **上下文注册** - 注册 koa、router、server 到全局上下文
- 📝 **Body 解析** - 自动解析 JSON 请求体

## 安装

```bash
pnpm add @zhin.js/http
```

## 使用

### 配置

在 `zhin.config.ts` 中启用：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: [
    'http',  // 启用 HTTP 插件
    // 其他插件...
  ],
  // HTTP 配置通过环境变量
  // port=8086
  // routerPrefix=/api
  // username=admin
  // password=123456
})
```

### 环境变量

```env
# HTTP 服务器端口
port=8086

# 路由前缀
routerPrefix=/api

# Basic Auth 认证
username=admin
password=123456
```

## 注册的上下文

HTTP 插件会注册以下上下文到全局：

```typescript
declare module '@zhin.js/types' {
  interface GlobalContext {
    koa: Koa          // Koa 应用实例
    router: Router    // 路由器实例
    server: Server    // HTTP 服务器实例
  }
}
```

## Router API

### HTTP 路由

```typescript
import { useContext } from 'zhin.js'

useContext(['router'], (router) => {
  // GET 请求
  router.get('/api/hello', async (ctx) => {
    ctx.body = { message: 'Hello, World!' }
  })
  
  // POST 请求
  router.post('/api/users', async (ctx) => {
    const data = ctx.request.body
    ctx.body = { success: true, data }
  })
  
  // PUT 请求
  router.put('/api/users/:id', async (ctx) => {
    const { id } = ctx.params
    ctx.body = { success: true, id }
  })
  
  // DELETE 请求
  router.delete('/api/users/:id', async (ctx) => {
    const { id } = ctx.params
    ctx.body = { success: true }
  })
  
  // 所有 HTTP 方法
  router.all('/api/wildcard', async (ctx) => {
    ctx.body = { method: ctx.method }
  })
  
  // 路由参数
  router.get('/api/posts/:id', async (ctx) => {
    const { id } = ctx.params
    ctx.body = { postId: id }
  })
  
  // 查询参数
  router.get('/api/search', async (ctx) => {
    const { q, page } = ctx.query
    ctx.body = { query: q, page }
  })
})
```

### WebSocket 路由

```typescript
useContext(['router'], (router) => {
  // 创建 WebSocket 服务器
  const wss = router.ws('/ws/chat')
  
  // 监听连接
  wss.on('connection', (ws, req) => {
    console.log('WebSocket 连接建立')
    
    // 接收消息
    ws.on('message', (data) => {
      const message = data.toString()
      console.log('收到消息:', message)
      
      // 发送消息
      ws.send(JSON.stringify({ echo: message }))
    })
    
    // 连接关闭
    ws.on('close', () => {
      console.log('WebSocket 连接关闭')
    })
    
    // 错误处理
    ws.on('error', (error) => {
      console.error('WebSocket 错误:', error)
    })
  })
  
  // 广播消息到所有客户端
  function broadcast(message: string) {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }
})
```

## 内置 API

HTTP 插件提供以下内置 API：

### 1. 系统状态

```http
GET /api/system/status
```

**响应：**
```json
{
  "success": true,
  "data": {
    "uptime": 12345.678,
    "memory": {
      "rss": 123456789,
      "heapTotal": 98765432,
      "heapUsed": 87654321,
      "external": 1234567
    },
    "cpu": {
      "user": 1000000,
      "system": 500000
    },
    "platform": "darwin",
    "nodeVersion": "v20.0.0",
    "pid": 12345,
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
}
```

### 2. 健康检查

```http
GET /api/health
```

**响应：**
```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### 3. 统计信息

```http
GET /api/stats
```

**响应：**
```json
{
  "success": true,
  "data": {
    "plugins": {
      "total": 10,
      "active": 8
    },
    "bots": {
      "total": 3,
      "online": 2
    },
    "commands": 25,
    "components": 15
  }
}
```

## 完整示例

### RESTful API

```typescript
import { useContext } from 'zhin.js'

// 用户管理 API
useContext(['router'], (router) => {
  const users = new Map()
  
  // 获取所有用户
  router.get('/api/users', async (ctx) => {
    ctx.body = {
      success: true,
      data: Array.from(users.values())
    }
  })
  
  // 获取单个用户
  router.get('/api/users/:id', async (ctx) => {
    const { id } = ctx.params
    const user = users.get(id)
    
    if (user) {
      ctx.body = { success: true, data: user }
    } else {
      ctx.status = 404
      ctx.body = { success: false, error: 'User not found' }
    }
  })
  
  // 创建用户
  router.post('/api/users', async (ctx) => {
    const { username, email } = ctx.request.body as any
    const id = Date.now().toString()
    
    const user = { id, username, email }
    users.set(id, user)
    
    ctx.status = 201
    ctx.body = { success: true, data: user }
  })
  
  // 更新用户
  router.put('/api/users/:id', async (ctx) => {
    const { id } = ctx.params
    const updates = ctx.request.body as any
    
    const user = users.get(id)
    if (user) {
      Object.assign(user, updates)
      ctx.body = { success: true, data: user }
    } else {
      ctx.status = 404
      ctx.body = { success: false, error: 'User not found' }
    }
  })
  
  // 删除用户
  router.delete('/api/users/:id', async (ctx) => {
    const { id } = ctx.params
    
    if (users.delete(id)) {
      ctx.body = { success: true }
    } else {
      ctx.status = 404
      ctx.body = { success: false, error: 'User not found' }
    }
  })
})
```

### WebSocket 聊天室

```typescript
import { useContext } from 'zhin.js'
import { WebSocket } from 'ws'

useContext(['router'], (router) => {
  const chatRoom = router.ws('/ws/chat')
  const clients = new Set<WebSocket>()
  
  chatRoom.on('connection', (ws) => {
    clients.add(ws)
    
    // 欢迎消息
    ws.send(JSON.stringify({
      type: 'system',
      message: 'Welcome to chat room!',
      users: clients.size
    }))
    
    // 广播用户加入
    broadcast({
      type: 'join',
      users: clients.size
    }, ws)
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      
      // 广播消息
      broadcast({
        type: 'message',
        data: message,
        timestamp: Date.now()
      })
    })
    
    ws.on('close', () => {
      clients.delete(ws)
      
      // 广播用户离开
      broadcast({
        type: 'leave',
        users: clients.size
      })
    })
  })
  
  function broadcast(data: any, exclude?: WebSocket) {
    const message = JSON.stringify(data)
    for (const client of clients) {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }
})
```

### Koa 中间件

```typescript
import { useContext } from 'zhin.js'

useContext(['koa'], (koa) => {
  // 自定义中间件
  koa.use(async (ctx, next) => {
    const start = Date.now()
    await next()
    const ms = Date.now() - start
    console.log(`${ctx.method} ${ctx.url} - ${ms}ms`)
  })
  
  // 错误处理中间件
  koa.use(async (ctx, next) => {
    try {
      await next()
    } catch (error) {
      ctx.status = 500
      ctx.body = {
        success: false,
        error: (error as Error).message
      }
    }
  })
  
  // CORS 中间件
  koa.use(async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*')
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
    ctx.set('Access-Control-Allow-Headers', 'Content-Type')
    await next()
  })
})
```

## Router 类型定义

```typescript
class Router {
  // HTTP 方法
  get(path: string, handler: (ctx: Context) => Promise<void>): void
  post(path: string, handler: (ctx: Context) => Promise<void>): void
  put(path: string, handler: (ctx: Context) => Promise<void>): void
  delete(path: string, handler: (ctx: Context) => Promise<void>): void
  patch(path: string, handler: (ctx: Context) => Promise<void>): void
  head(path: string, handler: (ctx: Context) => Promise<void>): void
  options(path: string, handler: (ctx: Context) => Promise<void>): void
  all(path: string, handler: (ctx: Context) => Promise<void>): void
  
  // 中间件
  use(middleware: (ctx: Context, next: () => Promise<void>) => Promise<void>): void
  
  // WebSocket
  ws(path: string): WebSocketServer
}
```

## 安全性

### Basic Auth

所有请求都需要通过 Basic Auth 认证：

```bash
# 使用 curl 访问
curl -u admin:123456 http://localhost:8086/api/health

# 使用 fetch
fetch('http://localhost:8086/api/health', {
  headers: {
    'Authorization': 'Basic ' + btoa('admin:123456')
  }
})
```

### 禁用认证（不推荐）

如果需要禁用认证（仅用于开发），可以修改插件源码或使用代理。

## 相关资源

- [Koa 文档](https://koajs.com/)
- [ws 文档](https://github.com/websockets/ws)
- [Zhin 完整文档](https://docs.zhin.dev)

## 许可证

MIT License
