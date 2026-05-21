# Zhin · Deno Deploy Playground（真实运行时）

在 [Deno Deploy](https://docs.deno.com/deploy/getting_started/) 上运行 **真实 `zhin.js` 启动链**，而不是手写一套假路由。

## 跑的是什么

| 组件 | 来源 |
|------|------|
| 根插件 / `usePlugin()` | `@zhin.js/core` |
| `registerCoreServices` | 与 `packages/zhin/src/setup/register-core-services.ts` 同构（无 process 适配器） |
| `initAgentModule()` | `@zhin.js/agent`（`MessageDispatcher`、AI trigger、ZhinAgent） |
| 演示命令 `zt` / `help` | 真实 `MessageCommand`（`src/plugins/demo.ts`） |
| WebSocket 入站 | `PlaygroundWsAdapter`（对齐 sandbox 的 `emit('message.receive')` → `runInboundMessage`） |

**不包含**：完整 IM 适配器（QQ/ICQQ 等长连接）。**包含** Edge 子集 Console REST/SSE + Queue 入站（`src/edge-http.ts`）。

本目录为 **Zhin Edge** 官方模板：单 `fetch` 入口 + Sandbox WS；启动日志含 `console=` 深链（与 Host 一致）。Console 登录 **API Base URL** 填部署域名根（无 `/api` 后缀）；公开发现见 `GET /pub/openapi.json`、`GET /pub/health`。

## 本地运行

```bash
cd examples/deno-deploy-playground
cp .env.example .env   # HTTP_TOKEN、OPENAI_*（与 test-bot 相同角色）
deno task dev
```

配置与 Host 一样使用 **`zhin.config.yml`**（`http` / `ai` / `plugins` 等）。Console / Queue **复用** `@zhin.js/console` 的 `dispatchConsoleRpc`（与 Host 同一套 `handlers-core`）。`edge:` 段控制 Queue `botId` 与 `consoleParity`。

Monorepo 内通过 `deno.json` 的 `imports` 指向 workspace 源码；无需先 `pnpm build`。

### 本地数据库（SQLite）

默认 `zhin.config.yml`：

```yaml
database:
  dialect: sqlite
  filename: ./data/playground.db
```

## 数据库：Edge 必须用 PostgreSQL

Deno Deploy **没有持久化磁盘**，`sqlite` + 本地文件 **不适合生产**。请使用托管 **PostgreSQL**（Neon、Supabase、Railway 等）：

1. 创建数据库，复制连接串 `postgres://…` 或 `postgresql://…`
2. 在 Deno Deploy 项目 **Environment Variables** 设置：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db?sslmode=require`（优先） |
| `HTTP_TOKEN` | Console / API Bearer（与 `zhin.config.yml` 中 `${HTTP_TOKEN}` 一致） |
| `OPENAI_API_KEY` | 可选，启用 AI |
| `OPENAI_BASE_URL` | 可选 |
| `HTTP_TRUST_PROXY` | 建议 `1`（Deploy 在 CDN 后） |
| `DATABASE_POOL_MAX` | 可选，默认由 `pg` 池配置 |

设置 `DATABASE_URL` 后，运行时 **自动** 使用 `dialect: pg`（`connectionString`），**无需**改 `zhin.config.yml`。本地不设 `DATABASE_URL` 时仍走 SQLite。

框架侧 dialect 名为 **`pg`**（不是 `postgres`），底层驱动为 npm `pg`。

## 部署到 Deno Deploy

`deno.deploy.json` **仅使用 npm 线上包**（无 `../../packages` 相对路径）。本地开发仍用 `deno.json` 指向 monorepo 源码。

### 首次：发布 Edge 依赖到 npm

下列包在发版前需先构建并 `pnpm publish`（版本与 `deno.deploy.json` 对齐）：

| 包 | 版本 | 说明 |
|----|------|------|
| `@zhin.js/http-host` | 0.1.2+ | 含 `./edge` 导出 |
| `@zhin.js/http` | 1.0.76+ | 含 `host-rest-api` 等子路径 |
| `@zhin.js/console` | 3.0.2+ | 含 `console-api`、`rpc/project-fs` |
| `@zhin.js/storage-port` | 0.1.0 | 新包 |
| `@zhin.js/queue-runtime` | 0.1.0 | 新包 |

仓库根目录示例：

```bash
pnpm --filter @zhin.js/http-host build
pnpm --filter @zhin.js/http build
pnpm --filter @zhin.js/console build
pnpm --filter @zhin.js/storage-port build
pnpm --filter @zhin.js/queue-runtime build
# 按你们发版流程 publish（changeset / pnpm publish -r 等）
```

### CLI 部署

```bash
cd examples/deno-deploy-playground
deno task deploy
# 等价于 deno deploy --prod --config deno.deploy.json main.ts
```

首次会提示登录 [console.deno.com](https://console.deno.com/) 并选择 org/project。

### Deno Deploy 控制台

1. **Entrypoint**：`main.ts`
2. **Config file**：`deno.deploy.json`
3. **Environment Variables**：见上表（至少 `DATABASE_URL`、`HTTP_TOKEN`）
4. Install / Build 留空；`nodeModulesDir: auto` 解析 `npm:` 依赖

部署完成后：

- 聊天 UI：`https://<your-app>.deno.dev/`
- Console API Base：`https://<your-app>.deno.dev`（无 `/api` 后缀）
- 健康检查：`https://<your-app>.deno.dev/pub/health`

## 与本地 test-bot 的关系

```text
本地 test-bot:  zhin dev → setup.ts → 全插件 + sandbox 控制台 + 多适配器
本 Playground:  Deno.serve → 同上 setup 子集 → 仅 WebSocket playground 适配器
```

要在 QQ/ICQQ 上对话，请继续用 `examples/test-bot`；本应用用于 **边缘演示 Zhin 消息内核 + Console Parity + 可选 AI**。

## 目录

- `zhin.config.yml` — AI / plugins / http / 本地 sqlite
- `deno.deploy.json` — 生产 import map（**纯 npm**，含 `npm:pg`）
- `deno.json` — 本地 monorepo 源码 imports
- `src/runtime/bootstrap.ts` — 启动入口
- `src/runtime/resolve-database-config.ts` — `DATABASE_URL` → PG
- `src/plugins/demo.ts` — 业务命令
- `src/adapter/playground-ws.ts` — WebSocket 适配器
- `static/index.html` — 聊天 UI

## 许可证

MIT
