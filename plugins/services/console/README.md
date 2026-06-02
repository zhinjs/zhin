# @zhin.js/console

Zhin Host 上的 **Console API** 插件：`PageManager`、`POST /api/console/request`、SSE `/api/events`、`GET /entries` 等。**聊天与管理 UI 不在本 Host 提供**（`serveClientHost: false`），请使用 **[Remote Console](https://console.zhin.dev)**（仓库 [zhin-console](https://github.com/zhinjs/zhin-console)）。说明见 [docs/console-remote.md](../../../docs/console-remote.md)。

## 功能特性（Host 侧）

- 📡 Console API + SSE 事件流
- 📋 `PageManager` / `addEntry`（适配器注册扩展入口，供 Remote UI 拉取）
- 📊 运行时状态经 API 暴露
- 🔧 插件与 Feature 调试数据
- 📝 日志与 OpenAPI（`GET /pub/openapi.json`）

### ICQQ 登录辅助（不在 Console 提供）

- **登录辅助的 HTTP API 与 Web UI 由 `@zhin.js/adapter-icqq` 注册**，Console 插件不再挂载 `/api/login-assist/*`。
- 启用 **console + icqq** 后，在控制台侧栏进入 **ICQQ 管理**（扩展入口 `/icqq`），在 **「登录辅助」** Tab 中完成扫码 / 验证码等流程。
- 未启用 icqq 时，不应存在 `/api/login-assist` 路由（为预期行为，不保留旧路径兼容）。

## 控制台扩展的 TypeScript 基线

适配器或插件若带有 **`client/`**（浏览器端），可在 `client/tsconfig.json` 中：

```json
{
  "extends": "@zhin.js/console/browser.tsconfig.json",
  "compilerOptions": { "outDir": "../dist" },
  "include": ["./**/*"]
}
```

Node 侧 **`src/`** 可参考 **`@zhin.js/console/node.tsconfig.json`**，并在本包 `tsconfig` 中补全 `rootDir`、`outDir`、`include`。

上述文件由本包 `exports` 随包发布。

## 技术架构

- **Host**：`@zhin.js/console` + `@zhin.js/console-core`（`PageManager`、`/@dev` 扩展打包）
- **UI**：独立仓库 **zhin-console**（Farm/Vite 等由该仓库维护）
- **客户端 SDK**：`@zhin.js/client`（Remote Console 依赖）
- **适配器扩展**：`client/` 产物经 `addEntry` 注册，由 Remote UI 加载

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

插件会自动注册 Console API 路由（与 `@zhin.js/http` 同端口，默认 `8086`）。

### 访问 UI（Remote Console）

1. 启动 Host：`pnpm dev` / `pnpm start`。
2. 浏览器打开 **https://console.zhin.dev**（或本地 [zhin-console](https://github.com/zhinjs/zhin-console) 开发服，如 `http://127.0.0.1:5173`）。
3. 登录：**API Base** 填 Host 监听地址（如 `http://127.0.0.1:8086`），**Token** 与 `.env` 中 `HTTP_TOKEN` 一致。

UI 在 Remote Console 打开，不在本机 `:8086` 上。健康检查：`GET http://127.0.0.1:8086/pub/health`。

### 配置选项

在 `zhin.config.yml` 中配置 console 插件：

```yaml
plugins:
  console:
    # 是否启用控制台插件，默认 true
    enabled: true
    
    # 是否延迟初始化 PageManager，默认 false
    # false: 启动时立即可用 addEntry（推荐）
    # true: 首次需要时再初始化（省内存，可能导致 sandbox/icqq 等扩展注册异常）
    lazyLoad: false
```

#### ⚠️ 关于 lazyLoad 的重要说明

**默认值为 `false`（不延迟加载）**，原因：

1. **其他插件依赖 `PageManager.addEntry`**：`@zhin.js/adapter-sandbox`、`@zhin.js/adapter-icqq` 等需在 `useContext('web', (pageManager) => { pageManager.addEntry({...}) })` 中注册控制台扩展（见各适配器 `src/index.ts`）
2. **Remote UI 依赖 entries**：Sandbox、ICQQ 等需在启动阶段完成 `addEntry`

**禁用 Console API**：
```yaml
plugins:
  console:
    enabled: false
```
- 💡 适合：仅需 IM/队列、不需要 Remote Console 与 Sandbox 浏览器调试的场景

## 生产环境

Host 侧始终为 **API-only**（不向 `:8086` 提供 Console 静态站）。生产部署 Remote Console 到 CDN/独立域名，Host 暴露 API 并配置 `http.token`、`http.corsOrigins`（含 `https://console.zhin.dev`）。详见 [docs/console-remote.md](../../../docs/console-remote.md)。

不需要 Remote Console / Sandbox 浏览器调试时，可 `console.enabled: false`。

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

<!-- 构建优化详见源码中的 build 逻辑 -->

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

在插件根目录使用 CLI 一并构建服务端与客户端：

```bash
# 在插件目录下（存在 src/ 则 tsc，存在 client/ 则打 dist）
pnpm exec zhin build
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
├── src/                 # 服务端源码
│   ├── index.ts        # Console 插件主入口
│   ├── build.ts        # 构建逻辑
│   ├── dev.ts          # Vite 开发服务器
│   ├── transform.ts    # TS/TSX/JSX 按需转译
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
