# @zhin.js/http

基于 Koa 的 HTTP 服务器插件，为 Zhin 机器人框架提供 HTTP API 和 WebSocket 支持。

## 功能特性

- 🌐 基于 Koa.js 的 HTTP 服务器
- 🔐 Basic Auth 身份验证
- 🛠️ RESTful API 支持
- 📡 WebSocket 实时通信
- 🔄 请求体解析 (JSON)
- 🌍 可配置的服务器设置
- 📊 路由管理和中间件支持
- 📋 内置 API 端点 (系统状态、插件管理、适配器信息)
- 📝 上下文描述信息支持

## 技术架构

- **HTTP框架**: Koa.js
- **路由**: 自定义Router类扩展@koa/router
- **WebSocket**: ws 库
- **身份验证**: koa-basic-auth
- **请求解析**: koa-bodyparser

## 安装

```bash
npm install @zhin.js/http
```

## 使用

### 基本使用

```javascript
// 插件会自动启动HTTP服务器
import '@zhin.js/http'
```

### 环境变量配置

```bash
# 服务器端口 (默认: 8086)
port=8086

# 路由前缀 (可选)
routerPrefix=/api

# 基础认证用户名 (默认: admin)
username=admin

# 基础认证密码 (默认: 123456)  
password=123456
```

## 核心组件

### Router 类

扩展了 `@koa/router` 的功能：

```typescript
class Router extends KoaRouter {
  // WebSocket服务器管理
  ws(path: string, options?: ServerOptions): WebSocketServer
  
  // 销毁路由
  destroy(layer: Layer): void
  
  // 销毁WebSocket服务器
  destroyWs(wsServer: WebSocketServer): void
  
  // 白名单管理（用于历史API排除）
  whiteList: Path[]
}
```

### 全局上下文

```typescript
declare module '@zhin.js/types' {
  interface GlobalContext {
    koa: Koa,           // Koa应用实例
    router: Router,     // 路由器实例  
    server: Server      // HTTP服务器实例
  }
}
```

## API 使用

### 内置 API 端点

插件提供以下内置 API：

#### 适配器管理 API
- `GET /api/adapters` - 获取所有上下文列表

**响应格式:**
```json
{
  "success": true,
  "data": [
    {
      "name": "icqq-adapter",
      "desc": "ICQQ适配器，用于连接QQ平台"
    },
    {
      "name": "web-console", 
      "desc": "Web控制台服务，提供管理界面"
    }
  ]
}
```

#### 其他 API
- `GET /api/system/status` - 系统状态信息
- `GET /api/plugins` - 插件列表
- `GET /api/config` - 配置信息
- `POST /api/message/send` - 发送消息
- `POST /api/plugins/:name/reload` - 重载插件
- `GET /api/health` - 健康检查

### 自定义 HTTP 路由

```javascript
import { useContext } from 'zhin.js'

useContext('router', async (router) => {
  // GET 请求
  router.get('/api/status', async (ctx) => {
    ctx.body = { status: 'ok' }
  })
  
  // POST 请求
  router.post('/api/message', async (ctx) => {
    const { message } = ctx.request.body
    // 处理消息...
    ctx.body = { success: true }
  })
})
```

### WebSocket 连接

```javascript
import { useContext } from 'zhin.js'

useContext('router', async (router) => {
  const ws = router.ws('/api/realtime')
  
  ws.on('connection', (socket) => {
    socket.send('连接成功')
    
    socket.on('message', (data) => {
      console.log('收到消息:', data)
    })
  })
})
```

### Koa 中间件

```javascript
import { useContext } from 'zhin.js'

useContext('koa', async (koa) => {
  koa.use(async (ctx, next) => {
    console.log('请求:', ctx.method, ctx.url)
    await next()
  })
})
```

## 服务器配置

### 启动配置

```javascript
{
  host: '0.0.0.0',     // 监听地址
  port: 8086           // 监听端口
}
```

### 身份验证

默认启用 Basic Auth：
- 用户名: `admin` (可通过环境变量修改)
- 密码: `123456` (可通过环境变量修改)

## WebSocket 功能

### 路径管理

- 支持多个WebSocket端点
- 自动路径匹配
- 连接升级处理

### 连接处理

```javascript
// 创建WebSocket服务器
const wsServer = router.ws('/chat')

// 处理连接
wsServer.on('connection', (ws, request) => {
  ws.send('欢迎连接')
})

// 销毁服务器
router.destroyWs(wsServer)
```

## 开发

### 项目结构

```
src/
├── index.ts      # 主入口，服务器初始化
└── router.ts     # Router类实现
```

### 构建

```bash
npm run build  # 构建插件
npm run clean  # 清理构建文件
```

## 依赖项

### 核心依赖
- `@koa/router` - Koa路由器
- `koa` - Koa.js框架
- `ws` - WebSocket库
- `koa-basic-auth` - 基础认证中间件
- `koa-bodyparser` - 请求体解析中间件

### 对等依赖
- `zhin.js` - Zhin核心框架

## 安全考虑

- 🔐 默认启用身份验证
- 🛡️ 请求体大小限制
- 🔒 WebSocket连接验证
- 📝 访问日志记录

## 使用场景

- 🌐 HTTP API服务
- 📊 管理后台接口  
- 📡 实时数据推送
- 🔧 Webhook接收
- 📱 移动应用后端

## 许可证

MIT License
