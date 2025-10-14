# 🧩 官方插件

Zhin 提供了一系列官方插件，为你的机器人添加强大的功能，包括 Web 服务、控制台管理、客户端界面等。

## 📁 插件目录配置

安装官方插件后，确保在配置中包含 `node_modules/@zhin.js` 目录：

```typescript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    plugin_dirs: [
      './src/plugins',           // 项目自定义插件
      'node_modules',            // 第三方插件
      'node_modules/@zhin.js'    // 官方插件（推荐）
    ],
    plugins: [
      'http',      // 官方插件
      'console',   // 官方插件
      // ... 其他插件
    ]
  }
})
```

## 📦 插件概览

| 插件 | 包名 | 功能 | 状态 | 依赖 |
|------|------|------|------|------|
| **HTTP** | `@zhin.js/http` | HTTP服务器 | ✅ 稳定 | Koa + Router |
| **Console** | `@zhin.js/console` | Web控制台 | ✅ 稳定 | Vue 3 + Vite |
| **Client** | `@zhin.js/client` | 客户端框架 | ✅ 稳定 | Vue 3 Router |

## 🌐 HTTP 插件

基于 Koa 的 HTTP 服务器插件，为机器人提供 Web 服务和基础认证。

### 安装

```bash
pnpm add @zhin.js/http
```

### 基础配置

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    plugins: [
      'http'  // 启用 HTTP 插件
    ]
  }
})
```

### 环境变量配置（实际使用方式）

HTTP 插件通过环境变量进行配置：

```bash
# .env
port=8086                    # HTTP服务端口（默认8086）
routerPrefix=                # 路由前缀（可选）
username=admin               # 基础认证用户名（默认admin）
password=123456              # 基础认证密码（默认123456）
```

### 实际启动信息

启动后会在控制台显示：

```bash
[HTTP] server is running at http://0.0.0.0:8086
[HTTP] your username is： admin
[HTTP] your password is： 123456
```

### 上下文服务

HTTP 插件注册了以下上下文服务：

```typescript
// 使用上下文服务
import { useContext } from 'zhin.js'

// 📡 使用服务器上下文
useContext('server', (server) => {
  console.log('HTTP服务器已启动:', server.address())
})

// 🌐 使用 Koa 应用上下文
useContext('koa', (koa) => {
  // 添加自定义中间件
  koa.use(async (ctx, next) => {
    console.log(`${ctx.method} ${ctx.url}`)
    await next()
  })
})

// 🛣️ 使用路由上下文
useContext('router', (router) => {
  // 添加自定义路由
  router.get('/api/custom', async (ctx) => {
    ctx.body = {
      message: '自定义API响应',
      timestamp: new Date().toISOString()
    }
  })
  
  // 带参数的路由
  router.get('/api/user/:id', async (ctx) => {
    const userId = ctx.params.id
    ctx.body = {
      user: userId,
      data: `用户 ${userId} 的数据`
    }
  })
})
```

### 类型声明

HTTP 插件提供以下 TypeScript 类型：

```typescript
declare module '@zhin.js/types' {
  interface GlobalContext {
    koa: Koa,           // Koa 应用实例
    router: Router,     // 路由实例
    server: Server      // HTTP 服务器实例
  }
}
```

### 特性

- 🚀 **高性能** - 基于 Koa 框架
- 🔐 **安全认证** - 支持基础认证和自定义认证
- 🌐 **CORS 支持** - 跨域资源共享配置
- 📁 **静态文件** - 静态资源服务
- 🔧 **可扩展** - 支持自定义路由和中间件
- 📡 **WebSocket** - 实时双向通信

## 🖥️ Console 插件

基于 Vue 3 的 Web 控制台，提供可视化的机器人管理界面。

### 安装

```bash
pnpm add @zhin.js/console
```

### 配置

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    plugins: [
      'http',      // Console 依赖 HTTP 插件
      'console'    // 启用 Console 插件
    ]
  }
})
```

### 高级配置

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    plugins: [
      {
        name: 'console',
        config: {
          title: 'Zhin Bot Dashboard',           // 页面标题
          theme: 'dark',                         // 主题：light/dark/auto
          routes: {                              // 自定义路由
            '/dashboard': 'dashboard',
            '/logs': 'logs',
            '/plugins': 'plugins'
          },
          auth: {                                // 访问控制
            enabled: true,
            username: env.CONSOLE_USERNAME,
            password: env.CONSOLE_PASSWORD
          }
        }
      }
    ]
  }
})
```

### 环境变量

```bash
# .env
CONSOLE_USERNAME=admin       # 控制台用户名
CONSOLE_PASSWORD=secret      # 控制台密码
```

### 访问控制台

启动机器人后，访问控制台：

```bash
# 启动机器人
pnpm dev

# 浏览器访问
`http://localhost:8086`
```

### 控制台功能

#### 1. 📊 仪表盘

- **系统状态** - CPU、内存使用情况
- **机器人状态** - 在线状态、连接数

#### 2. 🔧 上下文管理

Console 插件现支持显示所有上下文的详细信息，包括：

- **上下文列表** - 显示所有已注册的上下文服务
- **描述信息** - 展示每个上下文的功能说明和用途
- **状态监控** - 实时显示上下文的运行状态

```typescript
// 📝 上下文描述会自动在控制台中展示
register({
  name: 'my-service',
  description: '我的自定义服务，提供特定业务功能',
  async mounted() {
    // 服务实现
    return serviceInstance
  }
})
```

控制台会通过 `/api/adapters` 接口自动获取所有上下文信息：

```json
{
  "success": true,
  "data": [
    {
      "name": "my-service",
      "desc": "我的自定义服务，提供特定业务功能"
    }
  ]
}
```
- **消息统计** - 收发消息数量
- **插件状态** - 已加载插件列表

#### 2. 📝 实时日志

- **日志过滤** - 按级别、时间、来源过滤
- **实时更新** - WebSocket 实时推送
- **日志搜索** - 关键词搜索
- **导出功能** - 导出日志文件

#### 3. 🧩 插件管理

- **插件列表** - 查看所有插件状态
- **热重载** - 实时重载插件
- **配置编辑** - 在线编辑插件配置
- **性能监控** - 插件性能统计

#### 4. 🤖 机器人管理

- **连接状态** - 查看机器人连接状态
- **消息发送** - 直接发送测试消息
- **用户管理** - 管理用户权限
- **群组管理** - 管理群组设置

### 自定义页面（基于实际实现）

**步骤1：在插件中添加客户端入口**

```typescript
// src/plugins/web-extension.ts
import { useContext } from 'zhin.js'
import path from 'node:path'

// 使用 web 上下文添加客户端入口（来自 test-bot 实际代码）
useContext('web', (web) => {
  web.addEntry(path.resolve(path.resolve(import.meta.dirname, '../../client/index.ts')))
})
```

**步骤2：创建客户端页面入口文件**

```typescript
// client/index.ts
import { addPage } from '@zhin.js/client'

addPage({
  parentName: 'Zhin',          // 父级菜单名
  path: '/custom',             // 页面路径
  name: "自定义页面",           // 页面名称
  component: () => import('./CustomPage.vue')  // 组件导入函数
})
```

**步骤3：创建 Vue 页面组件**

```vue
<!-- client/CustomPage.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import InputText from 'primevue/inputtext'  // 使用 PrimeVue 组件

const uptime = ref('0s')
const messageCount = ref(0)

onMounted(async () => {
  // 获取机器人状态数据
  try {
    const response = await fetch('/api/bot/status')
    const data = await response.json()
    uptime.value = `${Math.floor(data.uptime / 60)}分钟`
    messageCount.value = data.messageCount || 0
  } catch (error) {
    console.error('获取状态失败:', error)
  }
})
</script>

<template>
  <section class="custom-page">
    <h1>🎯 自定义控制台页面</h1>
    
    <div class="info-cards">
      <div class="info-card">
        <h3>📊 运行信息</h3>
        <p>运行时间: {{ uptime }}</p>
        <p>消息数量: {{ messageCount }}</p>
      </div>
      
      <div class="info-card">
        <h3>🛠️ 快速操作</h3>
        <InputText 
          type="text" 
          placeholder="输入消息内容" 
          style="width: 100%"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.custom-page {
  padding: 20px;
}

.info-cards {
  display: flex;
  gap: 20px;
  margin-top: 20px;
}

.info-card {
  flex: 1;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #f9f9f9;
}
</style>
```

### 特性

- 🎨 **现代界面** - 基于 Vue 3 + Element Plus
- 📱 **响应式设计** - 支持桌面和移动设备
- 🔄 **实时更新** - WebSocket 实时数据
- 🎯 **可扩展** - 支持自定义页面和组件
- 🌗 **主题切换** - 深色/浅色主题
- 🔐 **访问控制** - 用户认证和权限管理

## 📱 Client 插件

Vue 3 客户端框架，为构建复杂的 Web 界面提供基础设施。

### 安装

```bash
pnpm add @zhin.js/client
```

### 配置

```javascript
// zhin.config.ts
export default defineConfig(async (env) => {
  return {
    plugins: [
      'http',      // Client 依赖 HTTP 插件
      'client'     // 启用 Client 插件
    ]
  }
})
```

### Vue 应用结构

```vue
<!-- src/client-app/App.vue -->
<template>
  <div id="app">
    <nav class="navbar">
      <router-link to="/">首页</router-link>
      <router-link to="/dashboard">仪表盘</router-link>
      <router-link to="/settings">设置</router-link>
    </nav>
    
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  console.log('Client 应用已挂载')
})
</script>
```

### 路由配置

```typescript
// src/client-app/router.ts
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory('/client'),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('./pages/Home.vue')
    },
    {
      path: '/dashboard',
      name: 'Dashboard', 
      component: () => import('./pages/Dashboard.vue')
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('./pages/Settings.vue')
    }
  ]
})

export default router
```

### 状态管理

```typescript
// src/client-app/store.ts
import { createStore } from 'vuex'

export default createStore({
  state: {
    botStatus: 'offline',
    messageCount: 0,
    plugins: []
  },
  
  mutations: {
    setBotStatus(state, status) {
      state.botStatus = status
    },
    
    setMessageCount(state, count) {
      state.messageCount = count
    },
    
    setPlugins(state, plugins) {
      state.plugins = plugins
    }
  },
  
  actions: {
    async fetchStatus({ commit }) {
      const response = await fetch('/api/status')
      const data = await response.json()
      
      commit('setBotStatus', data.status)
      commit('setMessageCount', data.messageCount)
      commit('setPlugins', data.plugins)
    }
  }
})
```

### API 服务

```typescript
// src/client-app/services/api.ts
class ApiService {
  private baseURL = '/api'
  
  async get(endpoint: string) {
    const response = await fetch(`${this.baseURL}${endpoint}`)
    return response.json()
  }
  
  async post(endpoint: string, data: any) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
    return response.json()
  }
  
  // 获取机器人状态
  getStatus() {
    return this.get('/status')
  }
  
  // 发送消息
  sendMessage(message: any) {
    return this.post('/message', message)
  }
  
  // 获取日志
  getLogs(params?: any) {
    const query = params ? `?${new URLSearchParams(params)}` : ''
    return this.get(`/logs${query}`)
  }
}

export default new ApiService()
```

### 组件库

```vue
<!-- src/client-app/components/BotStatus.vue -->
<template>
  <div class="bot-status" :class="statusClass">
    <div class="status-icon">
      <span :class="iconClass"></span>
    </div>
    <div class="status-info">
      <h3>{{ botName }}</h3>
      <p>{{ statusText }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  botName: String,
  status: String,
  uptime: Number
})

const statusClass = computed(() => ({
  'status-online': props.status === 'online',
  'status-offline': props.status === 'offline'
}))

const iconClass = computed(() => ({
  'icon-online': props.status === 'online',
  'icon-offline': props.status === 'offline'
}))

const statusText = computed(() => {
  if (props.status === 'online') {
    return `在线 · 运行 ${Math.floor(props.uptime / 60)}分钟`
  }
  return '离线'
})
</script>

<style scoped>
.bot-status {
  padding: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
}

.status-online {
  background: #f0f9ff;
  border: 1px solid #0ea5e9;
}

.status-offline {
  background: #fef2f2;
  border: 1px solid #ef4444;
}
</style>
```

### 插件注册

```typescript
// src/plugins/client-extension.ts
import { useContext } from 'zhin.js'

useContext('client', (client) => {
  // 注册页面
  client.addPage({
    path: '/custom',
    component: () => import('../client-app/pages/CustomPage.vue')
  })
  
  // 注册组件
  client.addComponent('CustomWidget', {
    template: '<div>自定义组件</div>'
  })
  
  // 添加全局样式
  client.addStyles(`
    .custom-theme {
      --primary-color: #ff6b6b;
      --secondary-color: #4ecdc4;
    }
  `)
})
```

### 特性

- ⚡ **Vue 3** - 使用最新的 Vue 3 框架
- 🎨 **组件化** - 可复用的 UI 组件
- 🧭 **路由系统** - Vue Router 单页应用
- 💾 **状态管理** - Vuex/Pinia 状态管理
- 📱 **响应式** - 适配各种设备尺寸
- 🔧 **可扩展** - 插件化架构

## 🔧 插件组合使用

### 完整 Web 服务

```javascript
// zhin.config.ts - 完整的Web服务配置
export default defineConfig(async (env) => {
  return {
    plugins: [
      // 基础 HTTP 服务
      {
        name: 'http',
        config: {
          port: 8086,  // 默认端口
          auth: {
            username: env.HTTP_USERNAME,
            password: env.HTTP_PASSWORD
          }
        }
      },
      
      // Web 控制台
      {
        name: 'console',
        config: {
          title: 'My Bot Console',
          theme: 'dark'
        }
      },
      
      // 客户端应用
      'client'
    ]
  }
})
```

### 多服务端口

```javascript
// zhin.config.ts - 多端口服务
export default defineConfig(async (env) => {
  return {
    plugins: [
      // API 服务
      {
        name: 'http',
        config: {
          port: 8086,  // 默认端口
          prefix: '/api'
        }
      },
      
      // 管理控制台（如需多端口）
      {
        name: 'http',
        alias: 'admin-http',
        config: {
          port: 8087,  // 第二个端口
          prefix: '/admin'
        }
      },
      
      'console',
      'client'
    ]
  }
})
```

## 📊 性能监控

### 内置监控

```typescript
// src/plugins/monitoring.ts
import { useContext, useLogger } from 'zhin.js'

const logger = useLogger()

useContext('http', (http) => {
  // 性能监控中间件
  http.app.use(async (ctx, next) => {
    const start = Date.now()
    await next()
    const duration = Date.now() - start
    
    // 记录慢请求
    if (duration > 1000) {
      logger.warn(`慢请求: ${ctx.method} ${ctx.url} - ${duration}ms`)
    }
    
    // 添加响应头
    ctx.set('X-Response-Time', `${duration}ms`)
  })
  
  // 监控端点
  http.router.get('/api/metrics', async (ctx) => {
    const metrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
    
    ctx.body = metrics
  })
})
```

## 🐛 故障排除

### 常见问题

#### HTTP 插件端口冲突

```bash
# 错误：端口 8086 已被占用
Error: listen EADDRINUSE :::8086

# 解决：更改端口或停止占用进程
port=8087
# 或
lsof -ti:8086 | xargs kill -9
```

#### Console 插件无法访问

```bash
# 检查插件是否正确启动
curl `http://localhost:8086`

# 检查认证配置
username=admin
password=123456
```

#### Client 插件构建失败

```bash
# 清理缓存
rm -rf node_modules/.vite
pnpm install

# 检查依赖版本
pnpm list vue
```

## 📚 更多资源

- 🏠 [回到首页](../index.md)
- 🔌 [官方适配器](./adapters.md)
- 🚀 [快速开始](../guide/quick-start.md)
- 🧩 [插件开发指南](../plugin/)
- 💡 [示例代码](../examples/)

---

💡 **提示**: HTTP + Console + Client 三个插件配合使用，可以为你的机器人提供完整的 Web 管理界面！
