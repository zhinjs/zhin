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

### 开发环境（完整安装）

```bash
npm install @zhin.js/console
# 或
pnpm add @zhin.js/console
```

### 生产环境（轻量安装）

**重要**：生产环境不需要 React、Vite 等依赖！

前端代码已在构建时打包到 `dist/` 目录，运行时只需要：
- `mime`：文件类型识别
- `ws`：WebSocket 服务器

```bash
# 生产环境安装（自动跳过 devDependencies）
npm install @zhin.js/console --production
# 或
pnpm add @zhin.js/console --prod
```

**效果**：
- ✅ 磁盘占用：~2MB（vs 开发环境 ~200MB）
- ✅ 运行时内存：17MB（直接读取静态文件）
- ✅ 依赖数量：2 个（vs 开发环境 20+ 个）

## 使用

### 基本配置

```javascript
// 在插件中使用
import '@zhin.js/console'
```

插件会自动：
1. 启动 Vite 开发服务器（开发模式）
2. 配置路由中间件
3. 设置 WebSocket 连接
4. 提供静态文件服务

### 访问地址

默认情况下，控制台可以通过以下地址访问：
```
http://localhost:8086/vite/
```

### 配置选项

在 `zhin.config.yml` 中配置 console 插件：

```yaml
plugins:
  console:
    # 是否启用控制台插件，默认 true
    enabled: true
    
    # 是否延迟加载 Vite（开发模式），默认 false
    # false: 启动时立即加载 Vite（推荐，确保 addEntry 等功能可用）
    # true: 首次访问时才启动 Vite（节省 ~23MB 内存，但可能导致其他插件功能异常）
    lazyLoad: false
```

#### ⚠️ 关于 lazyLoad 的重要说明

**默认值为 `false`（不延迟加载）**，原因：

1. **其他插件依赖 `addEntry`**：`@zhin.js/adapter-sandbox`、`@zhin.js/adapter-icqq` 等插件需要在启动时调用 `web.addEntry()` 注册前端入口
2. **WebSocket 需要提前准备**：实时通信功能需要 WebSocket 服务器立即可用
3. **用户体验更好**：访问控制台时立即可用，无需等待 Vite 启动

**如果你确定不需要这些功能**，可以启用延迟加载节省内存：
```yaml
plugins:
  console:
    lazyLoad: true  # 节省 ~23MB 启动内存
```
- ✅ 启动时内存: **18-20MB**
- ⚠️ 首次访问控制台: **+23MB**（Vite + React 生态）
- 💡 适合：不常访问控制台的生产环境

**立即加载模式**：
```yaml
plugins:
  console:
    lazyLoad: false
```
- ⚠️ 启动时内存: **42MB**
- ✅ 访问控制台: 无延迟
- 💡 适合：频繁使用控制台的开发环境

**禁用控制台**：
```yaml
plugins:
  console:
    enabled: false
```
- ✅ 内存: **0MB**（不加载）
- 💡 适合：生产环境或不需要 Web 控制台

## 生产环境优化

### 依赖优化

Console 插件采用**构建时打包**策略：

**构建时**（开发环境）：
```bash
# 安装所有依赖（包括 React、Vite）
pnpm install

# 构建前端到 dist/ 目录
pnpm --filter @zhin.js/console build:client
```

**运行时**（生产环境）：
```bash
# 只安装生产依赖（mime + ws）
pnpm install --prod

# 直接读取 dist/ 静态文件，无需 React
NODE_ENV=production pnpm start
```

**节省效果**：
- ✅ 磁盘空间: ~200MB → ~2MB（98% 减少）
- ✅ 依赖数量: 20+ → 2（90% 减少）
- ✅ 运行时内存: 保持 17MB（无额外开销）

### 环境变量

```bash
# 生产模式（使用预构建的静态文件）
NODE_ENV=production pnpm start

# 开发模式（使用 Vite HMR）
NODE_ENV=development pnpm dev
```

### 部署建议

1. **仅 API 服务**：禁用 console 插件
   ```yaml
   plugins:
     console:
       enabled: false
   ```

2. **需要 Web 控制台**：使用静态模式
   ```bash
   # 构建前端
   pnpm --filter @zhin.js/console build:client
   
   # 生产环境启动（自动使用静态文件）
   NODE_ENV=production pnpm start
   ```

3. **开发环境**：使用完整功能
   ```bash
   # 安装所有依赖（包括可选依赖）
   pnpm install
   
   # 开发模式启动
   pnpm dev
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
