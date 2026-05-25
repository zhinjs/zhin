# Zhin · Cloudflare Workers Edge Playground

在 [Cloudflare Workers](https://developers.cloudflare.com/workers/) 上运行 **真实 `zhin.js` Edge 启动链**（`bootstrapCloudflare` → `export default { fetch }`），与 [deno-deploy-playground](../deno-deploy-playground/README.md) / [vercel-edge](../vercel-edge/README.md) 同构。

## 跑的是什么

| 组件 | 说明 |
|------|------|
| 入口 | `src/index.ts` |
| 运行时包 | `zhin.js/cloudflare`（`npm:zhin.js@latest`） |
| Sandbox | HTTP+SSE |
| Console | 远程 Console + 部署域名 API Base |

**不包含**：IM 适配器、Workers 上无本地 SQLite 生产环境。

## 本地开发

```bash
cd examples/cloudflare-workers-edge
cp .env.example .env
pnpm install
pnpm run dev           # Node 模拟 Edge fetch → http://127.0.0.1:8002（推荐）
pnpm run dev:wrangler  # 真实 Workers（需 `scripts/write-dev-vars.mjs` 生成 `.dev.vars`）
```

**`wrangler dev`**：`adapter-sandbox` 经 `registerSandboxEdge()` 挂到 bootstrap 插件树（`@zhin.js/adapter-sandbox/edge`），不再依赖顶层 `usePlugin()` 或运行时 `import("@zhin.js/adapter-sandbox")`。
```

`wrangler.toml` 的 `[build] command` 在 `wrangler deploy` 时也会执行 `prepare-deploy`。

## 部署

**前提**：npm 已发布 `zhin.js/cloudflare` 与 Edge 依赖。

```bash
cd examples/cloudflare-workers-edge
npm install
npx wrangler login
npx wrangler deploy
```

或在 Cloudflare 控制台连接 Git，Root = `examples/cloudflare-workers-edge`，Build = `node scripts/prepare-deploy.mjs`。

### Secrets / 变量

```bash
wrangler secret put HTTP_TOKEN
wrangler secret put DATABASE_URL   # postgres://...
# 可选
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_BASE_URL
```

`HTTP_TRUST_PROXY=1` 可在 `[vars]` 或控制台设置。

发版 npm 后 **`wrangler deploy` 重发** 即可，不必锁死 `package.json` 版本（当前为 `@latest`）。

### 验证

- `https://<worker>.<account>.workers.dev/pub/health`
- Console API Base：`https://<worker>.<account>.workers.dev`
- `/sandbox-ui` 同源沙盒

## 技术说明

- `compatibility_flags = ["nodejs_compat"]`：配置加载与部分依赖需要 Node 兼容层。
- Console 静态资源通过 **`src/console-assets.manifest.json`** 内嵌（构建时由 `prepare-deploy` 生成），不依赖 Workers 读本地 `static/console/`。

## 目录

- `src/index.ts` — `bootstrapCloudflare`
- `wrangler.toml` — Worker 名 `zhin-cf-edge-playground`（可按账号改名）
- `zhin.config.yml`、`src/edge-console-assets.ts`、`scripts/`

## 相关

- Deno Deploy：[../deno-deploy-playground](../deno-deploy-playground/README.md)
- Vercel Edge：[../vercel-edge](../vercel-edge/README.md)
