# @zhin.js/host-router

Zhin Host **传输层**：`node:http` 监听、Koa、`Router`（含 WebSocket）、Bearer 鉴权、CORS。业务管理 API 在 [**@zhin.js/host-api**](../api/README.md)。`zhin.config` 使用 **`http:`** 配置端口与 Token。

## 功能特性

- 🌐 基于 Koa.js 的 HTTP 服务器
- 🔐 Token 身份验证
- 🛠️ HTTP 路由与中间件（管理面 REST 由 `@zhin.js/host-api` 注册）
- 📡 WebSocket 实时通信
- 🔄 请求体解析 (JSON)
- 🌍 可配置的服务器设置
- 📊 路由管理和中间件支持
- 📋 健康检查与 OpenAPI 清单（`GET /pub/health`、`GET /pub/openapi.json`）
- 📝 上下文描述信息支持

## 技术架构

- **HTTP框架**: Koa.js
- **路由**: 自定义Router类扩展@koa/router
- **WebSocket**: ws 库
- **身份验证**: Token 认证（Bearer Header）
- **请求解析**: koa-body

## 安装

```bash
npm install @zhin.js/host-router
```

## 使用

### 基本使用

```javascript
// 传输层：Koa + Router + Token
import '@zhin.js/host-router'
// 管理面 REST / Console 协议（需与 host-router 同启）
import '@zhin.js/host-api'
```

`plugins` 中请同时启用 `@zhin.js/host-router` 与 `@zhin.js/host-api`。

### 配置

在 `zhin.config.yml` 中配置：

```yaml
http:
  port: 8086            # 服务器端口（默认 8086）
  base: /api            # 路由前缀（默认 /api）
  token: your-token     # API 访问令牌（不填自动生成）
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
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      koa: Koa,           // Koa应用实例
      router: Router,     // 路由器实例  
      server: Server      // HTTP服务器实例
    }
  }
}
```

## API 使用

### 管理面 REST / Console 协议

本包**仅提供传输层**（Koa、`Router`、Bearer、CORS）。系统/插件/Bot REST、`POST /api/console/request`、SSE `/api/events`、`GET /entries` 等管理面路由由 [**@zhin.js/host-api**](../api/README.md) 注册。运行时路由清单：`GET /pub/openapi.json`（无需 Token）。

Remote Console UI 不在 Host 端口提供，见 [docs/console-remote.md](../../../docs/console-remote.md)。

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

默认启用 Token 认证，**仅保护 API 路径**（`/api/*`）。

Token 传递方式：
- **Header**: `Authorization: Bearer <token>`

以下 API 路径无需认证：
- 包含 `/webhook` 的路径（有自己的签名验证）
- 以 `/pub` 为前缀的路径（含 `/pub/health`）

在 **[Remote Console](https://console.zhin.dev)** 登录页填写 API Base（本 Host 地址 + `/api` 若需要）与 `.env` 中的 `HTTP_TOKEN`。Host 根路径不提供内置管理页 UI。

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
- `crypto` (Node.js built-in) - Token 生成
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
