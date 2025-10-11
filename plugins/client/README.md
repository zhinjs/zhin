# Zhin Client - 动态页面路由系统

基于 React Router 7.0 的动态页面管理系统，支持在 `main.tsx` 中直接进行页面路由操作。

## 特性

- 🌳 **树形路由结构** - 使用树形结构管理页面路由，支持任意深度的嵌套
- ✅ **动态页面管理** - 运行时添加、删除、更新页面
- ✅ **React Router 7.0** - 使用最新的 React Router
- ✅ **TypeScript 支持** - 完整的类型定义
- ✅ **WebSocket 集成** - 支持动态加载插件入口脚本
- ✅ **Redux 状态管理** - 集成 Redux 持久化
- ✅ **简单易用** - 在 `main.tsx` 中直接操作页面路由

## 安装

```bash
pnpm add react-router@7.0.0 events @types/events
```

## 基本使用

### 1. 设置页面路由

```tsx
// main.tsx
import { addPage, DynamicRouter } from '@zhin.js/client'

// 导入图标
import { Home, LayoutDashboard } from 'lucide-react'

// 添加页面
addPage({
  key: 'home',
  path: '/',
  title: '首页',
  icon: <Home className="w-5 h-5" />,
  element: <HomePage />
})

addPage({
  key: 'dashboard',
  path: '/dashboard',
  title: '仪表盘',
  icon: <LayoutDashboard className="w-5 h-5" />,
  element: <DashboardPage />
})

// 渲染应用
createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <PersistGate loading={null} persistor={persistor}>
      <DynamicRouter />
    </PersistGate>
  </Provider>
)
```

### 2. 页面操作

```tsx
import { addPage, removePage, updatePage } from '@zhin.js/client'

import { Settings } from 'lucide-react'

// 添加页面
addPage({
  key: 'settings',
  path: '/settings',
  title: '设置',
  icon: <Settings className="w-5 h-5" />,
  element: <SettingsPage />
})

// 删除页面
removePage('/settings')

// 更新页面
updatePage('/settings', {
  key: 'settings',
  path: '/settings',
  title: '设置（更新）',
  icon: <Settings className="w-5 h-5" />,
  element: <UpdatedSettingsPage />
})

// 向后兼容的旧 API（已废弃）
import { addRoute, removeRoute, updateRoute } from '@zhin.js/client'
// 这些 API 仍然可用，但推荐使用新的 addPage 等 API
```

### 3. 自动父路由查找

```tsx
// main.tsx
import { addPage } from '@zhin.js/client'
import { Home, Users, Settings } from 'lucide-react'

// 1. 添加顶级页面
addPage({
  key: 'home',
  path: '/',
  title: '首页',
  icon: <Home className="w-5 h-5" />,
  element: <HomePage />
})

addPage({
  key: 'admin',
  path: '/admin',
  title: '管理',
  element: <AdminLayout />
})

// 2. 自动查找父路由：/admin/users
// 会查找 /admin 是否存在，如果存在，插入 users 到 /admin
addPage({
  key: 'admin-users',
  path: '/admin/users',
  title: '用户管理',
  icon: <Users className="w-5 h-5" />,
  element: <UsersPage />
})

addPage({
  key: 'admin-settings',
  path: '/admin/settings',
  title: '系统设置',
  icon: <Settings className="w-5 h-5" />,
  element: <AdminSettingsPage />
})

// 3. 自动查找父路由：/admin/users/detail
// 会查找 /admin/users 是否存在，如果存在，插入 detail 到 /admin/users
addPage({
  key: 'user-detail',
  path: '/admin/users/detail',
  title: '用户详情',
  element: <UserDetailPage />
})

// 4. 动态添加嵌套页面
setTimeout(() => {
  // 会自动查找 /admin 是否存在，如果存在，插入 analytics 到 /admin
  addPage({
    key: 'admin-analytics',
    path: '/admin/analytics',
    title: '分析',
    element: <AnalyticsPage />
  })
}, 2000)

// 5. 动态添加更深层嵌套
setTimeout(() => {
  // 会自动查找 /admin/analytics 是否存在，如果存在，插入 reports 到 /admin/analytics
  addPage({
    key: 'analytics-reports',
    path: '/admin/analytics/reports',
    title: '分析报告',
    element: <ReportsPage />
  })
}, 4000)
```

### 4. 事件监听

```tsx
import { routerManager } from '@zhin.js/client'

// 监听路由变化
routerManager.onRouteChange(() => {
  console.log('Routes changed')
})

// 监听路由添加
routerManager.onRouteAdd((route) => {
  console.log('Route added:', route.path)
})

// 监听路由删除
routerManager.onRouteRemove((path) => {
  console.log('Route removed:', path)
})
```

## API 参考

### 页面管理 API（推荐）

```tsx
// 添加页面
addPage(route: RouteMenuItem): void

// 删除页面
removePage(path: string): void

// 更新页面
updatePage(path: string, updates: Partial<RouteMenuItem>): void

// 获取页面
getPage(path: string): RouteMenuItem | undefined

// 获取所有页面
getAllPages(): RouteMenuItem[]

// 清空所有页面
clearPages(): void
```

### 旧 API（已废弃，保留向后兼容）

```tsx
/** @deprecated 请使用 addPage */
addRoute(route: RouteMenuItem): void

/** @deprecated 请使用 removePage */
removeRoute(path: string): void

/** @deprecated 请使用 updatePage */
updateRoute(path: string, route: RouteMenuItem): void

/** @deprecated 请使用 getPage */
getRoute(path: string): RouteMenuItem | undefined

/** @deprecated 请使用 getAllPages */
getAllRoutes(): RouteMenuItem[]

/** @deprecated 请使用 clearPages */
clearRoutes(): void
```

### routerManager 对象

```tsx
// 事件监听方法
routerManager.onRouteChange(callback: () => void): () => void
routerManager.onRouteAdd(callback: (route: RouteConfig) => void): () => void
routerManager.onRouteRemove(callback: (path: string) => void): () => void
routerManager.onRouteUpdate(callback: (path: string, route: RouteConfig) => void): () => void
routerManager.onRouteClear(callback: () => void): () => void
```

### RouteMenuItem 接口

```tsx
interface RouteMenuItem {
  key: string              // 唯一标识
  path: string             // 路由路径
  title: string            // 页面标题
  icon?: ReactNode         // 图标元素（直接传入 React 元素，如 <Home className="w-5 h-5" />）
  element?: ReactNode      // React 组件
  children?: RouteMenuItem[]  // 子路由
  meta?: {
    order?: number         // 排序
    hideInMenu?: boolean   // 是否在菜单中隐藏
    requiresAuth?: boolean // 是否需要认证
    [key: string]: any
  }
}
```

## 高级用法

### 动态页面操作

```tsx
import { addPage, updatePage, removePage } from '@zhin.js/client'

// 运行时动态添加页面
setTimeout(() => {
  addPage({
    key: 'dynamic',
    path: '/dynamic',
    title: '动态页面',
    element: <div>Dynamic Page</div>
  })
}, 2000)

// 动态更新页面
setTimeout(() => {
  updatePage('/dynamic', {
    key: 'dynamic',
    path: '/dynamic',
    title: '动态页面（已更新）',
    element: <div>Updated Page</div>
  })
}, 4000)

// 动态删除页面
setTimeout(() => {
  removePage('/dynamic')
}, 6000)
```

### WebSocket 动态加载

```tsx
import { useWebSocket, addPage } from '@zhin.js/client'

function App() {
  // 连接 WebSocket，接收动态入口脚本
  const ws = useWebSocket({
    onMessage: (message) => {
      console.log('收到消息:', message)
    }
  })

  return (
    <div>
      <p>WebSocket 状态: {ws.connected ? '已连接' : '未连接'}</p>
      <p>已加载入口: {ws.entries.length}</p>
      <DynamicRouter />
    </div>
  )
}

// 插件入口脚本示例（my-plugin-entry.ts）
import { addPage } from '@zhin.js/client'
import { Puzzle } from 'lucide-react'

addPage({
  key: 'my-plugin',
  path: '/my-plugin',
  title: '我的插件',
  icon: <Puzzle className="w-5 h-5" />,
  element: <MyPluginPage />
})
```

### 事件统计

```tsx
// 路由统计
let routeCount = 0
routerManager.onRouteAdd(() => {
  routeCount++
  console.log(`Total routes: ${routeCount}`)
})

routerManager.onRouteRemove(() => {
  routeCount--
  console.log(`Total routes: ${routeCount}`)
})
```

### 条件事件监听

```tsx
// 只监听特定路径的路由变化
routerManager.onRouteAdd((route) => {
  if (route.path.startsWith('/admin')) {
    console.log('Admin route added:', route.path)
  }
})
```

## 注意事项

1. **路由路径唯一性** - 确保路由路径的唯一性，避免冲突
2. **事件清理** - 记得清理事件监听器，避免内存泄漏
3. **性能考虑** - 大量路由时考虑使用懒加载
4. **类型安全** - 使用 TypeScript 确保类型安全

## 示例项目

查看 `app/src/main.tsx` 中的完整示例。