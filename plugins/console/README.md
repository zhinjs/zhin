# @zhin.js/console

Zhin 机器人框架的 Web 控制台插件，提供开发环境下的可视化管理界面和调试工具。

## 功能特性

- 🌐 基于 Vite 的开发服务器
- 🔥 支持热模块替换 (HMR)
- 📊 实时状态监控
- 🔧 插件开发调试
- 📝 日志实时查看
- 🛠️ 开发工具集成
- 📱 WebSocket 实时通信

## 技术架构

- **构建工具**: Vite 7.x
- **前端框架**: Vue 3 + TypeScript
- **开发服务器**: 集成到 Koa 路由
- **WebSocket**: 实时数据同步
- **组件解析**: unplugin-vue-components
- **UI组件**: PrimeVue 自动导入

## 安装

```bash
npm install @zhin.js/console
```

## 使用

### 基本配置

```javascript
// 在插件中使用
import '@zhin.js/console'
```

插件会自动：
1. 启动 Vite 开发服务器
2. 配置路由中间件
3. 设置 WebSocket 连接
4. 提供静态文件服务

### 访问地址

默认情况下，控制台可以通过以下地址访问：
```
http://localhost:8086/vite/
```

## 核心功能

### Web 服务器集成

```typescript
interface WebServer {
  vite: ViteDevServer           // Vite开发服务器
  addEntry(entry: string): () => void  // 添加入口文件
  entries: Record<string, string>      // 入口文件映射
  ws: WebSocketServer          // WebSocket服务器
}
```

### 实时数据同步

- 📡 WebSocket 连接管理
- 🔄 动态入口文件更新
- 📊 状态实时同步
- 🔥 热更新支持

### 开发工具

- 🐛 调试信息展示
- 📝 实时日志查看
- 🔍 错误追踪
- ⚡ 性能监控

## 配置选项

### Vite 配置

```javascript
{
  root: '@zhin.js/client/app',
  base: '/vite/',
  plugins: [
    vue(),
    Components({
      resolvers: [PrimeVueResolver()]
    })
  ],
  server: {
    middlewareMode: true
  }
}
```

### 路由配置

- 支持所有路由通过 Vite 处理
- 静态文件自动服务
- 动态入口文件管理
- SPA 路由支持

## 开发

### 项目结构

```
src/
├── index.ts             # 主入口，集成Vite服务器
└── types/               # TypeScript类型定义
```

### 构建

```bash
npm run build  # 构建插件
npm run clean  # 清理构建文件
```

## WebSocket API

### 消息类型

```typescript
// 同步数据
{ type: 'sync', data: { key: string, value: any } }

// 添加数据
{ type: 'add', data: { key: string, value: any } }

// 删除数据
{ type: 'delete', data: { key: string, value: any } }
```

## 依赖项

### 核心依赖
- `@vitejs/plugin-vue` - Vue插件支持
- `koa-connect` - Koa中间件集成
- `vue` - Vue框架
- `vite` - 构建工具

### 对等依赖
- `@zhin.js/client` - 客户端代码
- `@zhin.js/http` - HTTP服务器
- `unplugin-vue-components` - 组件自动导入
- `@primevue/auto-import-resolver` - PrimeVue组件解析

## 使用场景

- 🧪 插件开发和调试
- 📊 机器人状态监控
- 🔍 问题诊断和分析
- 🛠️ 开发环境管理

## 许可证

MIT License
