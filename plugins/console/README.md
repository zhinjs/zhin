# @zhin.js/console

Zhin 机器人框架的 Web 控制台插件，提供完整的 Web 管理界面。

## 特性

- 🌐 **Web 界面** - 基于 React 的现代化管理界面
- 📊 **实时监控** - WebSocket 实时数据更新
- 🎨 **UI 组件** - 基于 Radix UI 和 Tailwind CSS
- 🔥 **热重载** - Vite 开发服务器，支持 HMR
- 📦 **模块化** - 支持动态加载插件客户端
- 🎯 **类型安全** - 完整的 TypeScript 支持

## 安装

```bash
pnpm add @zhin.js/console
```

## 依赖

Console 插件依赖以下插件：

- `@zhin.js/http` - 提供 HTTP 服务和路由
- `@zhin.js/client` - 提供前端框架

## 使用

### 配置

在 `zhin.config.ts` 中启用：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: [
    'http',        // HTTP 服务（必需）
    'console',     // Web 控制台
    // 其他插件...
  ]
})
```

### 访问控制台

启动应用后，访问：

```
http://localhost:8086
```

默认认证信息：
- 用户名：`admin`
- 密码：`123456`

## 功能特性

### 1. Web 服务器

Console 插件注册一个 `web` 上下文，提供：

```typescript
declare module '@zhin.js/types' {
  interface GlobalContext {
    web: WebServer
  }
}

interface WebServer {
  vite: ViteDevServer            // Vite 开发服务器
  addEntry(entry: WebEntry): () => void  // 添加客户端入口
  entries: Record<string, string>  // 已注册的入口
  ws: WebSocketServer            // WebSocket 服务器
}
```

### 2. 动态入口

其他插件可以注册自己的前端组件：

```typescript
import { useContext } from 'zhin.js'
import path from 'path'

useContext(['web'], (web) => {
  // 注册客户端入口
  const entryPath = path.resolve(import.meta.dirname, '../client/index.tsx')
  const dispose = web.addEntry(entryPath)
  
  // 返回清理函数
  return dispose
})
```

### 3. 实时数据同步

通过 WebSocket 实时推送数据更新：

**WebSocket 端点：**
```
ws://localhost:8086/server
```

**消息格式：**

同步入口列表：
```json
{
  "type": "sync",
  "data": {
    "key": "entries",
    "value": ["/vite/@fs/path/to/entry.tsx"]
  }
}
```

添加入口：
```json
{
  "type": "add",
  "data": {
    "key": "entries",
    "value": "/vite/@fs/path/to/entry.tsx"
  }
}
```

删除入口：
```json
{
  "type": "delete",
  "data": {
    "key": "entries",
    "value": "/vite/@fs/path/to/entry.tsx"
  }
}
```

数据更新通知（每5秒）：
```json
{
  "type": "data-update",
  "timestamp": 1234567890
}
```

初始化数据：
```json
{
  "type": "init-data",
  "timestamp": 1234567890
}
```

## Vite 配置

Console 插件使用 Vite 作为开发服务器，配置如下：

```typescript
{
  root: 'node_modules/@zhin.js/client/app',
  base: '/vite/',
  plugins: [
    react(),              // React 支持
    tailwindcss(),        // Tailwind CSS
  ],
  server: {
    middlewareMode: true,  // 中间件模式
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@zhin.js/client': 'node_modules/@zhin.js/client/src',
      '@': 'node_modules/@zhin.js/client/app/src',
    },
  }
}
```

## 路由处理

Console 插件提供以下路由逻辑：

1. **API 路由** - 优先级最高，直接传递到下一个中间件
2. **动态入口** - 检查已注册的入口文件
3. **静态文件** - 检查文件系统中的静态资源
4. **SPA 回退** - 所有其他路由返回 `index.html`

## 完整示例

### 注册插件客户端

```typescript
// my-plugin/src/index.ts
import { useContext } from 'zhin.js'
import path from 'path'

useContext(['web'], (web) => {
  // 注册客户端组件
  const clientPath = path.resolve(import.meta.dirname, '../client/index.tsx')
  const dispose = web.addEntry(clientPath)
  
  return dispose
})
```

```tsx
// my-plugin/client/index.tsx
import React from 'react'

export default function MyPluginUI() {
  return (
    <div>
      <h1>My Plugin UI</h1>
      <p>这是我的插件界面</p>
    </div>
  )
}
```

### 使用 WebSocket

```typescript
// 前端代码
const ws = new WebSocket('ws://localhost:8086/server')

ws.onopen = () => {
  console.log('WebSocket 连接建立')
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  
  switch (message.type) {
    case 'sync':
      // 同步数据
      console.log('同步:', message.data)
      break
      
    case 'add':
      // 添加项目
      console.log('添加:', message.data)
      break
      
    case 'delete':
      // 删除项目
      console.log('删除:', message.data)
      break
      
    case 'data-update':
      // 数据更新通知
      console.log('数据更新')
      break
      
    case 'init-data':
      // 初始化数据
      console.log('初始化')
      break
  }
}

ws.onerror = (error) => {
  console.error('WebSocket 错误:', error)
}

ws.onclose = () => {
  console.log('WebSocket 连接关闭')
}
```

## WebEntry 类型

```typescript
type WebEntry = string | {
  production: string
  development: string
}

// 使用示例
web.addEntry('./client/index.tsx')

// 或区分环境
web.addEntry({
  development: './client/index.dev.tsx',
  production: './client/index.prod.tsx'
})
```

## 客户端框架

Console 插件基于 `@zhin.js/client` 构建，提供：

- React 19
- React Router
- Redux Toolkit
- Radix UI
- Tailwind CSS
- Lucide React Icons

## 开发指南

### 创建客户端组件

```tsx
// client/MyComponent.tsx
import React, { useState, useEffect } from 'react'

export default function MyComponent() {
  const [data, setData] = useState([])
  
  useEffect(() => {
    // 获取数据
    fetch('/api/my-data', {
      headers: {
        'Authorization': 'Basic ' + btoa('admin:123456')
      }
    })
      .then(res => res.json())
      .then(data => setData(data))
  }, [])
  
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">My Component</h2>
      <ul>
        {data.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
```

### 使用 Tailwind CSS

```tsx
export default function StyledComponent() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="bg-white shadow rounded-lg p-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Hello, World!
        </h1>
        <p className="mt-2 text-gray-600">
          This is a styled component.
        </p>
        <button className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          Click Me
        </button>
      </div>
    </div>
  )
}
```

### 使用 Radix UI

```tsx
import { Button } from '@radix-ui/themes'
import { Box, Flex, Text } from '@radix-ui/themes'

export default function RadixExample() {
  return (
    <Box p="4">
      <Flex direction="column" gap="3">
        <Text size="6" weight="bold">Radix UI Example</Text>
        <Button variant="solid" color="blue">
          Click Me
        </Button>
      </Flex>
    </Box>
  )
}
```

## 目录结构

```
plugins/console/
├── src/
│   └── index.ts          # 插件入口
├── app/                   # 前端应用（来自 @zhin.js/client）
│   ├── index.html
│   └── src/
│       └── ...
├── global.d.ts           # 全局类型定义
├── package.json
└── README.md
```

## 性能优化

### 1. 数据更新节流

Console 插件每 5 秒推送一次数据更新通知，而不是实时推送，以减少网络开销。

### 2. Vite HMR

开发模式下使用 Vite HMR，无需刷新页面即可看到代码变更。

### 3. 按需加载

客户端组件通过动态入口按需加载，不会影响主应用性能。

## 相关资源

- [Vite 文档](https://vitejs.dev/)
- [React 文档](https://react.dev/)
- [Radix UI 文档](https://www.radix-ui.com/)
- [Tailwind CSS 文档](https://tailwindcss.com/)
- [Zhin 完整文档](https://docs.zhin.dev)

## 许可证

MIT License
