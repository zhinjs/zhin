# 客户端开发指南

本指南说明如何在 Zhin.js 项目中开发自定义的 Web 控制台页面。

## 🏗️ 架构概述

### 模块关系

```
@zhin.js/client (客户端 SDK)
├── src/              # API 导出（addPage, useWebSocket 等）
├── app/              # Vite 应用入口（实际运行的前端）
├── package.json      # 包含 React、Redux 等依赖
└── browser.tsconfig.json  # 浏览器环境的 TS 配置

@zhin.js/console (控制台插件)
├── 创建 Vite 开发服务器
├── root: node_modules/@zhin.js/client/app
├── addEntry() 动态注册用户代码
└── WebSocket 服务

用户项目/client (自定义页面)
├── index.tsx         # 使用 addPage 注册页面
├── tsconfig.json     # 继承 browser.tsconfig.json
└── 其他组件
```

### 运行时流程

1. **Console 插件启动**：创建 Vite 服务器，root 指向 `@zhin.js/client/app`
2. **动态入口注册**：通过 `web.addEntry()` 注册用户的 `client/index.tsx`
3. **模块解析**：Vite 通过 alias 解析 `@zhin.js/client` 到源码目录
4. **依赖共享**：所有依赖（React、lucide-react 等）来自 `@zhin.js/client`

## 📝 项目配置

### 1. TypeScript 配置

创建 `client/tsconfig.json`：

```json
{
  "extends": "@zhin.js/client/browser.tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "baseUrl": ".",
    "types": ["react", "react-dom", "lucide-react"]
  },
  "include": ["./**/*"],
  "exclude": ["node_modules"]
}
```

### 2. package.json 配置

虽然运行时依赖来自 `@zhin.js/client`，但为了 TypeScript 类型提示，需要在 devDependencies 中添加：

```json
{
  "devDependencies": {
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.1",
    "lucide-react": "^0.469.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "typescript": "^5.0.0"
  }
}
```

**为什么需要这些依赖？**

- **运行时**：由 `@zhin.js/client` 提供，Vite 从其 `node_modules` 加载
- **编译时**：TypeScript 需要类型定义文件（`.d.ts`）才能提供智能提示
- **解决方案**：在 devDependencies 中安装，只用于类型检查，不打包

### 3. 项目结构

```
your-bot/
├── src/
│   └── plugins/         # 后端插件
├── client/              # 前端代码
│   ├── tsconfig.json    # TypeScript 配置
│   ├── index.tsx        # 入口文件
│   ├── MyPage.tsx       # 自定义页面
│   └── components/      # 组件目录
├── zhin.config.ts       # Zhin 配置
└── package.json
```

## 🎨 开发自定义页面

### 基础页面

```typescript
// client/index.tsx
import { addPage } from '@zhin.js/client'
import MyPage from './MyPage'

addPage({
  key: 'my-page',
  path: '/my-page',
  title: '我的页面',
  icon: 'Home',  // 使用字符串，对应 lucide-react 的图标名称
  Component: MyPage  // 使用 Component 而不是 element
})
```

```typescript
// client/MyPage.tsx
import { useWebSocket } from '@zhin.js/client'
import { useState, useEffect } from 'react'

export default function MyPage() {
  const [data, setData] = useState([])
  const ws = useWebSocket()

  useEffect(() => {
    // 监听 WebSocket 消息
    ws.on('data-update', (message) => {
      setData(message.data)
    })

    return () => {
      ws.off('data-update')
    }
  }, [ws])

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">我的自定义页面</h1>
      <div className="grid gap-4">
        {data.map((item) => (
          <div key={item.id} className="p-4 border rounded">
            {item.content}
          </div>
        ))}
      </div>
    </div>
  )
}
```

### 使用 Redux Store

```typescript
import { useSelector, useDispatch } from 'react-redux'
import { RootState } from '@zhin.js/client'

export default function StatefulPage() {
  const user = useSelector((state: RootState) => state.user)
  const dispatch = useDispatch()

  return (
    <div>
      <p>当前用户: {user.name}</p>
      <button onClick={() => dispatch({ type: 'user/logout' })}>
        登出
      </button>
    </div>
  )
}
```

### 使用 WebSocket

```typescript
import { useWebSocket } from '@zhin.js/client'

export default function RealtimePage() {
  const ws = useWebSocket()

  const sendMessage = () => {
    ws.send({
      type: 'custom-action',
      data: { message: 'Hello' }
    })
  }

  useEffect(() => {
    ws.on('custom-response', (data) => {
      console.log('收到响应:', data)
    })
  }, [ws])

  return (
    <button onClick={sendMessage}>发送消息</button>
  )
}
```

## 🎯 可用的 UI 组件

### Radix UI Themes

```typescript
import { Button, Card, Flex, Text } from '@radix-ui/themes'

export default function StyledPage() {
  return (
    <Card>
      <Flex direction="column" gap="3">
        <Text size="5" weight="bold">标题</Text>
        <Button>点击我</Button>
      </Flex>
    </Card>
  )
}
```

### Lucide Icons

```typescript
import { 
  Home, Settings, Users, Mail, 
  AlertCircle, CheckCircle 
} from 'lucide-react'

export default function IconsPage() {
  return (
    <div className="flex gap-4">
      <Home className="w-6 h-6 text-blue-500" />
      <Settings className="w-6 h-6 text-gray-500" />
      <Users className="w-6 h-6 text-green-500" />
    </div>
  )
}
```

### Tailwind CSS

所有 Tailwind 工具类都可用：

```typescript
export default function TailwindPage() {
  return (
    <div className="container mx-auto p-4">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          标题
        </h1>
        <p className="text-gray-600">
          使用 Tailwind CSS 样式
        </p>
      </div>
    </div>
  )
}
```

## 🔧 常见问题

### 1. TypeScript 飘红但运行正常

**问题**：导入 `lucide-react` 或 `react` 时 TypeScript 报错，但代码可以运行。

**原因**：
- 运行时：依赖来自 `@zhin.js/client` 的 node_modules
- 编译时：TypeScript 在项目的 node_modules 中找不到类型定义

**解决方案**：
在项目的 `package.json` 中添加 devDependencies：

```json
{
  "devDependencies": {
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.1",
    "lucide-react": "^0.469.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  }
}
```

然后运行：
```bash
pnpm install
```

### 2. 页面没有显示

检查以下几点：

1. **插件是否启用**
   ```typescript
   // zhin.config.ts
   export default defineConfig({
     plugins: ['http', 'console', 'adapter-process']
   })
   ```

2. **addEntry 是否调用**
   ```typescript
   // 在插件中
   useContext('web', (web) => {
     web.addEntry(path.resolve(import.meta.dirname, './client/index.tsx'))
   })
   ```

3. **路由路径是否冲突**
   ```typescript
   addPage({
     path: '/my-unique-path',  // 确保路径唯一
     // ...
   })
   ```

### 3. 热重载不工作

Vite 的 HMR 应该自动工作。如果不行：

1. 检查浏览器控制台是否有 WebSocket 连接错误
2. 确认 Vite 服务器正在运行（访问 `http://localhost:8086/`）
3. 尝试刷新页面

### 4. 样式不生效

确保使用了正确的 className 语法：

```typescript
// ✅ 正确
<div className="p-4 bg-white">

// ❌ 错误
<div class="p-4 bg-white">
```

## 📚 API 参考

### addPage

```typescript
interface PageConfig {
  key: string              // 唯一标识符
  path: string            // 路由路径
  title: string           // 显示标题
  icon?: ReactNode        // 菜单图标
  element: ReactNode      // 页面组件
  parent?: string         // 父页面 key（用于嵌套）
}

function addPage(config: PageConfig): void
```

### useWebSocket

```typescript
interface WebSocketClient {
  send(data: any): void
  on(event: string, handler: Function): void
  off(event: string, handler: Function): void
}

function useWebSocket(): WebSocketClient
```

### useSelector / useDispatch

来自 `react-redux`，用于访问全局状态：

```typescript
const state = useSelector((state: RootState) => state)
const dispatch = useDispatch()
```

## 🎓 最佳实践

1. **组件化**：将页面拆分为小组件
2. **类型安全**：使用 TypeScript 接口定义数据结构
3. **错误处理**：使用 try-catch 处理异步操作
4. **性能优化**：使用 React.memo 和 useMemo
5. **样式一致**：使用 Radix UI Themes 和 Tailwind CSS
6. **状态管理**：复杂状态使用 Redux，简单状态使用 useState

## 🔗 相关链接

- [React 文档](https://react.dev/)
- [Radix UI Themes](https://www.radix-ui.com/themes/docs)
- [Lucide Icons](https://lucide.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Vite 文档](https://vitejs.dev/)
