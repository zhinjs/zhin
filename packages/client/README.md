# Zhin Client - 动态页面路由与插件配置系统

基于 React Router 7.0 的动态页面管理系统，集成插件配置功能，支持基于 Schema 的自动表单生成。

## 特性

### 路由系统
- 🌳 **树形路由结构** - 使用树形结构管理页面路由，支持任意深度的嵌套
- ✅ **动态页面管理** - 运行时添加、删除、更新页面
- ✅ **React Router 7.0** - 使用最新的 React Router
- ✅ **TypeScript 支持** - 完整的类型定义
- ✅ **WebSocket 集成** - 支持动态加载插件入口脚本
- ✅ **Redux 状态管理** - 集成 Redux 持久化

### 配置系统
- 🔧 **Schema 驱动** - 支持 15 种 Schema 数据类型
- 📝 **自动表单生成** - 根据 Schema 自动生成配置表单
- 🎨 **智能 UI 组件** - 针对不同类型自动选择最佳 UI 控件
- 🔄 **实时配置更新** - 支持配置文件的实时读取和保存
- 🧩 **模块化设计** - 17 个独立的字段渲染器，易于扩展

## 安装

```bash
pnpm add react-router@7.0.0 events @types/events
```

## 基本使用

### 1. 设置页面路由

```tsx
// main.tsx
import { addPage, DynamicRouter } from '@zhin.js/client'

// 添加页面 - 使用 Component 而不是 element，icon 使用字符串
addPage({
  key: 'home',
  path: '/',
  title: '首页',
  icon: 'Home',  // 图标名称对应 lucide-react 的组件名
  Component: HomePage
})

addPage({
  key: 'dashboard',
  path: '/dashboard',
  title: '仪表盘',
  icon: 'LayoutDashboard',
  Component: DashboardPage
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

// 添加页面
addPage({
  key: 'settings',
  path: '/settings',
  title: '设置',
  icon: 'Settings',
  Component: SettingsPage
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
  icon: 'Home',
  Component: HomePage
})

addPage({
  key: 'admin',
  path: '/admin',
  title: '管理',
  Component: AdminLayout
})

// 2. 自动查找父路由：/admin/users
// 会查找 /admin 是否存在，如果存在，插入 users 到 /admin
addPage({
  key: 'admin-users',
  path: '/admin/users',
  title: '用户管理',
  icon: 'Users',
  Component: UsersPage
})

addPage({
  key: 'admin-settings',
  path: '/admin/settings',
  title: '系统设置',
  icon: 'Settings',
  Component: AdminSettingsPage
})

// 3. 自动查找父路由：/admin/users/detail
// 会查找 /admin/users 是否存在，如果存在，插入 detail 到 /admin/users
addPage({
  key: 'user-detail',
  path: '/admin/users/detail',
  title: '用户详情',
  Component: UserDetailPage
})

// 4. 动态添加嵌套页面
setTimeout(() => {
  // 会自动查找 /admin 是否存在，如果存在，插入 analytics 到 /admin
  addPage({
    key: 'admin-analytics',
    path: '/admin/analytics',
    title: '分析',
    Component: AnalyticsPage
  })
}, 2000)

// 5. 动态添加更深层嵌套
setTimeout(() => {
  // 会自动查找 /admin/analytics 是否存在，如果存在，插入 reports 到 /admin/analytics
  addPage({
    key: 'analytics-reports',
    path: '/admin/analytics/reports',
    title: '分析报告',
    Component: ReportsPage
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
  const DynamicPage = () => <div>Dynamic Page</div>
  addPage({
    key: 'dynamic',
    path: '/dynamic',
    title: '动态页面',
    Component: DynamicPage
  })
}, 2000)

// 动态更新页面
setTimeout(() => {
  const UpdatedPage = () => <div>Updated Page</div>
  updatePage('/dynamic', {
    key: 'dynamic',
    path: '/dynamic',
    title: '动态页面（已更新）',
    Component: UpdatedPage
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

addPage({
  key: 'my-plugin',
  path: '/my-plugin',
  title: '我的插件',
  icon: 'Puzzle',
  Component: MyPluginPage
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

## 插件配置系统

### Schema 支持的数据类型

Zhin Client 配置系统完整支持所有 15 种 Schema 数据类型：

#### 基础类型
- `string` - 字符串（支持枚举/多行/单行）
- `number` / `integer` - 数字（支持 min/max 限制）
- `boolean` - 布尔值（开关控件）

#### 特殊类型
- `percent` - 百分比（滑块 + 数字输入）
- `date` - 日期（日期选择器）
- `regexp` - 正则表达式（带验证）
- `const` - 常量（只读显示）

#### 集合类型
- `list` - 列表（支持嵌套）
- `tuple` - 元组（固定字段）
- `object` - 对象（嵌套结构）
- `dict` - 字典（JSON 编辑器）

#### 组合类型
- `union` - 联合类型（多选一）
- `intersect` - 交叉类型（满足所有）

#### 通用类型
- `any` - 任意类型（JSON 编辑器）
- `never` - 永不类型（警告提示）

### 使用插件配置组件

```tsx
import PluginConfigForm from '@zhin.js/client/components/PluginConfigForm'

<PluginConfigForm
  pluginName="my-plugin"
  onClose={() => setDialogOpen(false)}
  onSuccess={() => refetchPlugin()}
/>
```

### 定义插件配置 Schema

```typescript
import { Schema } from 'zhin.js'

export const config = Schema.object({
  // 基础类型
  name: Schema.string('插件名称').required(),
  enabled: Schema.boolean('是否启用').default(true),
  port: Schema.number('端口').min(1).max(65535).default(3000),
  
  // 特殊类型
  opacity: Schema.percent('透明度').default(0.8),
  startDate: Schema.date('开始日期'),
  pattern: Schema.regexp('匹配模式'),
  
  // 集合类型
  tags: Schema.list(Schema.string(), '标签'),
  server: Schema.object({
    host: Schema.string().default('localhost'),
    port: Schema.number().default(3000)
  }),
  
  // 组合类型
  mode: Schema.union([
    Schema.const('auto'),
    Schema.const('manual')
  ])
})
```

### 配置表单特性

- **自动渲染**: 根据 Schema 类型自动选择合适的 UI 组件
- **智能分组**: 简单字段直接展示，复杂字段可折叠
- **嵌套支持**: 完整支持任意深度的嵌套结构
- **实时验证**: 输入时进行类型验证和格式检查
- **紧凑布局**: 使用 ScrollArea 和 Accordion 优化空间使用

## 组件架构

### PluginConfigForm 模块结构

```
PluginConfigForm/
├── types.ts                      - 类型定义
├── BasicFieldRenderers.tsx       - 基础类型渲染器 (9个)
├── CollectionFieldRenderers.tsx  - 集合类型渲染器 (5个)
├── CompositeFieldRenderers.tsx   - 组合类型渲染器 (2个)
├── FieldRenderer.tsx             - 字段渲染器主入口
├── NestedFieldRenderer.tsx       - 嵌套字段渲染器
└── index.tsx                     - 主组件
```

17 个独立渲染器，职责单一，易于测试和扩展。

## 注意事项

1. **路由路径唯一性** - 确保路由路径的唯一性，避免冲突
2. **事件清理** - 记得清理事件监听器，避免内存泄漏
3. **性能考虑** - 大量路由时考虑使用懒加载
4. **类型安全** - 使用 TypeScript 确保类型安全
5. **Schema 定义** - 为插件配置定义清晰的 Schema，提供友好的描述信息

## 示例项目

查看 `app/src/main.tsx` 中的完整示例。