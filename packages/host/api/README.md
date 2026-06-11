# @zhin.js/host-api

Zhin Host 上的 **官方管理面 API**（路线 A：`@zhin.js/host-router` 仅传输，本包注册 REST / Console 协议 / entries）。

包含：`PageManager`、`POST /api/console/request`、SSE `/api/events`、`GET /entries`、系统/插件/Bot REST、市场与日志 API 等。**聊天与管理 UI 不在本 Host 提供**（`serveClientHost: false`），请使用 **[Remote Console](https://console.zhin.dev)**（仓库 [zhin-console](https://github.com/zhinjs/zhin-console)）。说明见 [docs/console-remote.md](../../../docs/console-remote.md)；完整 Console 需求见 [docs/console/requirements.md](../../../docs/console/requirements.md)。

## 功能特性（Host 侧）

- 📡 Console 协议（RPC + SSE）与管理 REST
- 📋 `PageManager` / `addEntry`（适配器注册扩展入口，供 Remote UI 拉取）
- 📊 运行时状态经 API 暴露
- 🔧 插件与 Feature 调试数据
- 📝 日志与 OpenAPI（`GET /pub/openapi.json`）
- 🌳 Agent 会话树（ADR 0010）：`GET /api/agent/sessions/:sessionKey/tree`、`POST .../leaf`（`messageId` 或 `index`）
- 🔍 内省列表（分页）：`GET /api/introspection/{commands|endpoints|bindings|tools|mcp}`（query：`page`、`filter`、`pageSize`）；完整请求/响应字段见 `GET /pub/openapi.json` → `components.schemas.Introspection*`

### ICQQ 登录辅助（不在 Console 提供）

- **登录辅助的 HTTP API 与 Web UI 由 `@zhin.js/adapter-icqq` 注册**，Console 插件不再挂载 `/api/login-assist/*`。
- 启用 **host-api + icqq** 后，在 Remote Console 侧栏进入 **ICQQ 管理**（扩展入口 `/icqq`），在 **「登录辅助」** Tab 中完成扫码 / 验证码等流程。
- 未启用 icqq 时，不应存在 `/api/login-assist` 路由（为预期行为，不保留旧路径兼容）。

## 控制台扩展的 TypeScript 基线

适配器或插件若带有 **`client/`**（浏览器端），可在 `client/tsconfig.json` 中：

```json
{
  "extends": "@zhin.js/host-api/browser.tsconfig.json",
  "compilerOptions": { "outDir": "../dist" },
  "include": ["./**/*"]
}
```

Node 侧 **`src/`** 可参考 **`@zhin.js/host-api/node.tsconfig.json`**，并在本包 `tsconfig` 中补全 `rootDir`、`outDir`、`include`。

上述文件由本包 `exports` 随包发布。

## 技术架构

- **Host**：`@zhin.js/host-router`（传输）+ `@zhin.js/host-api` + `@zhin.js/pagemanager`（`PageManager`、`/@dev` 扩展打包）；契约 **`@zhin.js/contract`**
- **UI**：独立仓库 **zhin-console**（Farm/Vite 等由该仓库维护）
- **客户端 SDK**：`@zhin.js/client`（Remote Console 依赖）
- **适配器扩展**：`client/` 产物经 `addEntry` 注册，由 Remote UI 加载

## 安装

### 开发环境（完整安装）

```bash
npm install @zhin.js/host-api
# 或
pnpm add @zhin.js/host-api
```

### 与 host-router 配对

管理面 API 依赖同一 Host 上的 `@zhin.js/host-router`（`http:` 配置：端口、token、CORS）。仅 IM、不需要 Remote Console 时可 `hostApi.enabled: false`。

## 使用

### 基本配置

```javascript
// 在插件中使用
import '@zhin.js/host-api'
```

插件会自动注册 Console API 路由（与 `@zhin.js/host-router` 同端口，默认 `8086`）。

### 访问 UI（Remote Console）

1. 启动 Host：`pnpm dev` / `pnpm start`。
2. 浏览器打开 **https://console.zhin.dev**（或本地 [zhin-console](https://github.com/zhinjs/zhin-console) 开发服，如 `http://127.0.0.1:5173`）。
3. 登录：**API Base** 填 Host 监听地址（如 `http://127.0.0.1:8086`），**Token** 与 `.env` 中 `HTTP_TOKEN` 一致。

UI 在 Remote Console 打开，不在本机 `:8086` 上。健康检查：`GET http://127.0.0.1:8086/pub/health`。

### 配置选项

在 `zhin.config.yml` 中配置 Host API 插件：

```yaml
hostApi:
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

**禁用 Host API**：
```yaml
hostApi:
  enabled: false
```
- 💡 适合：仅需 IM/队列、不需要 Remote Console 与 Sandbox 浏览器调试的场景

## 生产环境

Host 侧始终为 **API-only**（不向 `:8086` 提供 Console 静态站）。生产部署 Remote Console 到 CDN/独立域名，Host 暴露 API 并配置 `http.token`、`http.corsOrigins`（含 `https://console.zhin.dev`）。详见 [docs/console-remote.md](../../../docs/console-remote.md)。

不需要 Remote Console / Sandbox 浏览器调试时，可 `hostApi.enabled: false`。

## Remote Console（UI）

静态站点与 Farm 开发服在 monorepo 根目录 **`zhin-console/`**（npm 包名 `zhin-console-site`），依赖 `@zhin.js/client` 连接 Host API，**不**依赖本包运行时安装。

```bash
cd zhin-console && pnpm install && pnpm dev
```

## 开发

### 项目结构（本包）

```
packages/host/api/
├── src/
│   ├── index.ts           # 插件入口（PageManager + REST 注册）
│   ├── console-api.ts     # Console RPC 路由
│   ├── rest/              # Host / 市场 / 日志 REST
│   ├── rpc/               # Console RPC 处理器
│   └── websocket.ts       # SSE / WS hub
├── browser.tsconfig.json  # 适配器 client/ 继承用
└── lib/                   # tsup 构建产物
```

### 构建

```bash
pnpm --filter @zhin.js/host-api build
```

## WebSocket / SSE

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

### 运行时
- `@zhin.js/pagemanager`、`@zhin.js/contract`、`ws`

### 对等依赖
- `@zhin.js/host-router`、`@zhin.js/core`、`@zhin.js/client`、`koa`

## 使用场景

- Remote Console 与 Sandbox 调试
- 插件/Bot 管理 REST 与 Console 协议
- 适配器 `client/` 扩展入口（`addEntry`）

## 许可证

MIT License
