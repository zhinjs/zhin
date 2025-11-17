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
- **前端框架**: React 18 + React Router 7 + TypeScript
- **UI 组件库**: Radix UI + Tailwind CSS
- **状态管理**: Redux Toolkit + Redux Persist
- **开发服务器**: 集成到 Koa 路由
- **WebSocket**: 实时数据同步
- **构建优化**: Vendor Chunks 分割，支持插件复用公共依赖

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
  vite?: ViteDevServer           // Vite开发服务器
  addEntry(entry: string): () => void  // 添加入口文件
  entries: Record<string, string>      // 入口文件映射
  ws: WebSocketServer          // WebSocket服务器
}
```

### 构建优化

Console 插件采用智能的构建优化策略，显著减少重复打包：

- **Vendor Chunks 分割**: 将公共依赖分割成独立的 JS 文件
  - `vendor-react.js` - React 核心库 (~190KB)
  - `vendor-ui.js` - UI 组件库 (~250KB)
  - `vendor-redux.js` - 状态管理 (~23KB)
  - 其他分组...

- **插件依赖复用**: 其他插件构建时自动外部化公共依赖
  - 插件体积减少 ~90% (从 650KB → 30KB)
  - 浏览器缓存复用，提升加载速度
  - 开发和生产环境统一体验

详见 [BUILD_OPTIMIZATION.md](./BUILD_OPTIMIZATION.md)

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
  root: 'plugins/console/client',
  base: '/vite/',
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    middlewareMode: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // 自动分割 vendor chunks
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': ['@radix-ui/themes', 'lucide-react'],
          'vendor-redux': ['@reduxjs/toolkit', 'redux-persist'],
          // ...
        }
      }
    }
  }
}
```

### 插件客户端构建

使用 `zhin-client` 工具构建插件客户端代码：

```bash
# 在插件目录下
npx zhin-client build

# 或使用相对路径
node ../../plugins/console/lib/bin.js build
```

配置会自动外部化公共依赖，生成轻量级的插件代码。

### 路由配置

- 支持所有路由通过 Vite 处理
- 静态文件自动服务
- 动态入口文件管理
- SPA 路由支持

## 开发

### 项目结构

```
console/
├── app/                 # 构建工具
│   ├── index.ts        # Console 插件主入口
│   ├── build.ts        # 构建逻辑 (buildConsoleClient, buildPluginClient)
│   ├── dev.ts          # Vite 开发服务器
│   ├── websocket.ts    # WebSocket 管理
│   └── bin.ts          # CLI 工具
├── client/             # 前端应用
│   ├── src/            # React 应用源码
│   ├── index.html      # SPA 入口
│   └── ...
├── dist/               # 构建产物
│   ├── assets/
│   │   ├── vendor-react-*.js       # React vendor chunk
│   │   ├── vendor-ui-*.js          # UI vendor chunk
│   │   └── ...
│   └── index.html
└── lib/                # TypeScript 编译产物
```

### 构建

```bash
npm run build         # 构建插件 (TypeScript)
npm run build:client  # 构建客户端 (React SPA)
npm run clean         # 清理构建文件
```

构建产物说明：
- `lib/` - Node.js 运行的插件代码
- `dist/` - 浏览器加载的客户端代码，包含分割的 vendor chunks

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
- `@vitejs/plugin-react` - React 插件支持
- `@tailwindcss/vite` - Tailwind CSS 集成
- `koa-connect` - Koa 中间件集成
- `react` / `react-dom` - React 框架
- `react-router` - 路由管理
- `@reduxjs/toolkit` - 状态管理
- `@radix-ui/themes` - UI 组件库
- `vite` - 构建工具

### 对等依赖
- `@zhin.js/client` - 客户端基础库
- `@zhin.js/http` - HTTP 服务器

## 使用场景

- 🧪 插件开发和调试
- 📊 机器人状态监控
- 🔍 问题诊断和分析
- 🛠️ 开发环境管理

## 许可证

MIT License
