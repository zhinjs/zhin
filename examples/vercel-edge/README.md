# Zhin · Vercel Edge Playground

在 [Vercel Edge Functions](https://vercel.com/docs/functions/runtimes/edge) 上运行 **真实 `zhin.js` Edge 启动链**（`bootstrapVercel` → 单 `fetch` 入口），与 [deno-deploy-playground](../deno-deploy-playground/README.md) / [cloudflare-workers-edge](../cloudflare-workers-edge/README.md) 同构。

## 跑的是什么

| 组件 | 说明 |
|------|------|
| 入口 | `api/index.ts` → `export default fetch` |
| 运行时包 | `zhin.js/vercel`（`npm:zhin.js@latest`） |
| Sandbox | HTTP+SSE（`adapter-sandbox` + `/@assets/sandbox.mjs`） |
| Console | 远程 https://console.zhin.dev ，API Base = 部署域名根 |

**不包含**：IM 长连接适配器、本地 process 终端。

## 本地 / 预览

从 **monorepo 根** 或本目录构建 Console 资源（需能解析 `plugins/adapters/sandbox`）：

```bash
cd examples/vercel-edge
cp .env.example .env   # HTTP_TOKEN、OPENAI_*
pnpm install
pnpm run dev           # Node 模拟 Edge fetch → http://127.0.0.1:8001
# 或使用官方 CLI（需 vercel login）：pnpm start  → vercel dev -L --listen 8001
```

Monorepo 内依赖为 `workspace:*`；发版部署前请将 `package.json` 改回 `npm:@latest`（见 Deno playground README）。

`prepare-deploy` 生成 `src/console-assets.manifest.json`（内嵌 `.mjs`，Workers/Vercel 无读盘）与可选的 `static/console/`。产物已 gitignore，部署时由 `vercel.json` 的 `buildCommand` 再生。

## 部署到 Vercel

**前提**：npm 已发布带 `./vercel` 导出的 `zhin.js@latest` 及 Edge 依赖包（与 Deno playground 相同）。

| 项 | 值 |
|----|-----|
| Root Directory | `examples/vercel-edge` |
| Framework Preset | Other |
| Build Command | `node scripts/prepare-deploy.mjs`（或留空用 `vercel.json` 内 `buildCommand`） |
| Install Command | `npm install`（拉 `package.json` 的 `@latest`） |

`vercel.json` 已将全部路径 **rewrite** 到 `api/index.ts`，并由 Edge Function 内嵌 manifest 提供 `/@assets`、`/esm`。

### 环境变量（至少）

| 变量 | 说明 |
|------|------|
| `HTTP_TOKEN` | 与 `zhin.config.yml` 的 `http.token` |
| `DATABASE_URL` | 托管 PostgreSQL（`postgres://...`）；Edge 无持久磁盘，勿依赖 SQLite |
| `HTTP_TRUST_PROXY` | 建议 `1` |

发版后 **Redeploy** 即可拾取 `npm:@latest`，无需改版本号。

### 验证

- 健康检查：`https://<your-app>.vercel.app/pub/health`
- Console API Base：`https://<your-app>.vercel.app`（无 `/api` 后缀）
- 同源沙盒页：`https://<your-app>.vercel.app/sandbox-ui`

## 目录

- `api/index.ts` — `bootstrapVercel`
- `zhin.config.yml` — Edge 插件与服务
- `src/edge-console-assets.ts` — `/entries`、`/@assets`、`/esm`
- `scripts/prepare-deploy.mjs` — 构建 manifest + esbuild 资源

## 相关

- Deno Deploy：[../deno-deploy-playground](../deno-deploy-playground/README.md)
- Cloudflare Workers：[../cloudflare-workers-edge](../cloudflare-workers-edge/README.md)
