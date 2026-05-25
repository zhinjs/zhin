# Zhin · Deno Deploy Playground（真实运行时）

在 [Deno Deploy](https://docs.deno.com/deploy/getting_started/) 上运行 **真实 `zhin.js` 启动链**，而不是手写一套假路由。

## 跑的是什么

| 组件 | 来源 |
|------|------|
| 根插件 / `usePlugin()` | `@zhin.js/core` |
| `registerCoreServices` | 与 Host 同构；**process** 在本地 TTY 启用（Deno stdin），Deploy 无 stdin 自动跳过 |
| `initAgentModule()` | `@zhin.js/agent`（`MessageDispatcher`、AI trigger、ZhinAgent） |
| 演示命令 `zt` / `help` | 真实 `MessageCommand`（`src/plugins/demo.ts`） |
| Sandbox 入站 | `@zhin.js/adapter-sandbox` HTTP+SSE（`/sandbox/events`、`/sandbox/message`） |

**不包含**：完整 IM 适配器（QQ/ICQQ 等长连接）。**包含** Edge 子集 Console REST/SSE + Queue 入站（`src/edge-http.ts`）。

本目录为 **Zhin Edge** 官方模板：单 `fetch` 入口 + Sandbox SSE；启动日志含 `console=` 深链。Console **API Base URL** 填部署域名根（无 `/api` 后缀）；根路径 `/` 无 UI（404），沙盒在远程 Console 加载。

## 本地运行

```bash
cd examples/deno-deploy-playground
cp .env.example .env   # HTTP_TOKEN、OPENAI_*（与 test-bot 相同角色）
deno task dev
```

配置与 Host 一样使用 **`zhin.config.yml`**（`http` / `ai` / `plugins` 等）。Console / Queue **复用** `@zhin.js/console` 的 `dispatchConsoleRpc`（与 Host 同一套 `handlers-core`）。`edge:` 段控制 Queue `botId` 与 `consoleParity`。

### Process 适配器（本地终端）

与 Node Host 相同：`services` 含 `process` 时，在**交互式终端**（`deno task dev`）可从 stdin 发消息走完整 `MessageDispatcher` 链路。Deno Deploy 无 TTY/stdin，运行时自动不注册 process。Web 聊天走下面的 Sandbox 传输（Edge 为 HTTP+SSE）。

### Sandbox Web 沙盒（双传输）

| 能力 | Node Host | Deno Edge Playground |
|------|-----------|----------------------|
| 传输 | **WebSocket** `/sandbox` | **HTTP+SSE**（`transport: http-sse`） |
| 下行 | WS 帧 | `GET /sandbox/events?session=` |
| 上行 | WS 帧 | `POST /sandbox/message` + `X-Sandbox-Session` |
| 协议 / Bot | `@zhin.js/adapter-sandbox` | 同包，`registerSandboxSseRoutes` |
| 控制台 React UI | `@zhin.js/console` + `adapter-sandbox` `addEntry` | **`deno task build:console-assets`** 后远程 Console 可加载 `/@assets/sandbox.mjs` |
| 每连接 bot 名 | 无 yaml 时随机 `sandbox-xxxx` | yaml 固定 **`edge-bot`** |

`zhin.config.yml`：`context: sandbox`，`name: edge-bot`，`transport: http-sse`。客户端通过 `GET /api/info` 的 `sandboxTransport` 自动选 SSE 或 WS。Console 里若只见 PID 数字机器人，那是 **process** 适配器（`.env` 设 `ZHIN_BIND_STDIN=1` 且 `services` 含 `process`）。

**本地沙盒 UI（推荐）**：`http://127.0.0.1:8000/sandbox-ui`（与 API 同源，避免 https://console.zhin.dev 访问 http API 被浏览器拦截）。远程 Console 配 http API 仅在同源或 HTTPS 隧道下可用。

Monorepo 内通过 `deno.json` 的 `imports` 指向 workspace 源码；`deno task dev` 会自动跑 **`predev`** 构建 Console 资源。

### 远程 Console 加载沙盒插件

```bash
deno task build:console-assets   # 产出 static/console/{assets,esm}/
deno task dev
```

1. 远程 Console → **API Base URL** = `http://127.0.0.1:8000`（**不要**写成 `.../api`）
2. **访问令牌**填与 `.env` 中 `HTTP_TOKEN` 相同的值（否则 `/api/events` SSE 不会连接）
3. 刷新后应出现 **沙盒** 菜单；若 `/@assets/sandbox.mjs` 404，先执行 `deno task build:console-assets` 并重启 `deno task dev`
4. 沙盒页自动连 SSE：`/sandbox/events` + `/sandbox/message`（见 `/api/info`）

`console.zhin.dev/marketplace` 404 是**远程 Console 站点**自己的前端路由，与应用市场 API（`GET /pub/marketplace/search`）无关；插件搜索走后者即可。

本地可先 `deno task build:console-assets` 验证；**勿提交** `static/console/` 与 `src/console-assets.manifest.json`（已 gitignore），Deno Deploy 的 pre-deploy 会重新生成。manifest 供 Vercel / Cloudflare 等无读盘 Edge 内嵌 `/@assets`。

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

`deno.deploy.json` 运行时依赖一律 **`npm:…@latest`**（含 `zhin.js/deno`）。发版到 npm 后只需 **重新部署**，不必改 `deno.deploy.json` 里的版本号。

**前提**：至少发过一版带 `./deno` / `./node` 等导出的 `zhin.js`，以及 Edge 所需的 `@zhin.js/*` 包（`http-host/edge`、`console`、`adapter-sandbox/edge` 等）。未发版就部署会报 `Package subpath './deno' is not defined`。

日常流程：`pnpm publish`（或你们 changeset 流程）→ Deno Deploy **Retry build** 即可。

### CLI 部署

```bash
cd examples/deno-deploy-playground
deno task predeploy   # 生成 static/console/assets（可省略，predeploy 已挂在 deploy 上）
deno task deploy
# 等价于 deno deploy --prod --config deno.deploy.json main.ts
```

首次会提示登录 [console.deno.com](https://console.deno.com/) 并选择 org/project。非交互环境请设置：

```bash
export DENO_DEPLOY_TOKEN="<从 console.deno.com 账户设置复制>"
```

生产环境变量（在 Deploy 控制台 **Environment Variables** 配置，至少）：

| 变量 | 说明 |
|------|------|
| `HTTP_TOKEN` | 与 `zhin.config.yml` 中 `http.token` 对应 |
| `DATABASE_URL` | 托管 PostgreSQL（`postgres://...`）；不设则 SQLite，Deploy 上不可用 |
| `HTTP_TRUST_PROXY` | 建议 `1`（CDN 后） |

### Deno Deploy 控制台（GitHub 源，org: `zhinjs`）

在 [console.deno.com/zhinjs](https://console.deno.com/zhinjs) 创建/编辑应用 **`zhin-deno-playground`**，并连接 **`zhinjs/zhin`** 仓库（勿选其它 repo）。推荐构建配置：

| 项 | 值 |
|----|-----|
| App directory | `examples/deno-deploy-playground` |
| Entrypoint | `main.ts` |
| Config file | `deno.deploy.json` |
| **Install command** | **留空**（运行时依赖由 Deno 的 `deno.deploy.json` + `nodeModulesDir: auto` 拉取 `npm:`，**不要**在仓库根跑 `pnpm install`） |
| **Pre-deploy command** | `node scripts/prepare-deploy.mjs` |
| **Build command** | 留空（或 `deno cache --config deno.deploy.json main.ts`） |

`prepare-deploy` 只生成 **`static/console/*`**（本仓库内的 sandbox UI 打包产物）。**不要**在仓库根跑 `pnpm install` 给 Deno 用；运行时全靠 `deno.deploy.json` 的 `npm:@latest`。

`@latest` 会随 npm 最新版浮动；若某次发版含 breaking change，部署可能受影响。需要锁版本时再改回 `npm:zhin.js@1.0.xx` 等固定号。

**Environment Variables**（至少 `DATABASE_URL`、`HTTP_TOKEN`；可选 `OPENAI_*`、`HTTP_TRUST_PROXY=1`）

生产域名一般为：`https://zhin-deno-playground.zhinjs.deno.dev`（以控制台为准）。

部署完成后：

- 根路径 `/` 不托管本地 UI（404）；请用远程 Console
- Console API Base：`https://<your-app>.deno.dev`（无 `/api` 后缀）
- 健康检查：`https://<your-app>.deno.dev/pub/health`

## 与本地 test-bot 的关系

```text
本地 test-bot:  zhin dev → zhin.js/node bootstrapNode → 全插件 + sandbox 控制台 + 多适配器
本 Playground:  Deno.serve(rt.fetch) → zhin.js/deno bootstrapDeno → Edge HTTP + Sandbox（http-sse）
```

要在 QQ/ICQQ 上对话，请继续用 `examples/test-bot`；本应用用于 **边缘演示 Zhin 消息内核 + Console Parity + 可选 AI**。

同构 Edge 部署模板：**Vercel** → `examples/vercel-edge`；**Cloudflare Workers** → `examples/cloudflare-workers-edge`。

## 目录

- `zhin.config.yml` — AI / plugins / http / 本地 sqlite
- `deno.deploy.json` — 生产 import map（**纯 npm**，含 `npm:pg`）
- `deno.json` — 本地 monorepo 源码 imports
- `main.ts` — `bootstrapDeno` + `Deno.serve(rt.fetch)`
- `src/edge-console-assets.ts` — `/entries`、`/@assets`、`/esm`（manifest 或读盘）
- `src/plugins/demo.ts` — 业务命令
- `plugins/adapters/sandbox` — 官方包；Edge 经 `@zhin.js/adapter-sandbox/edge` 注册 WS
## 许可证

MIT
