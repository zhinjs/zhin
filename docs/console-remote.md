# Remote Console（GitHub Pages）

Zhin Host **不提供** `/console` 静态页，仅提供 Console API。官方 UI 通过 GitHub Pages 发布（见 workflow `console-pages.yml`）。使用方式：

1. 打开 Console URL（推荐自定义域 **`https://console.zhin.dev`**，站点在域名根路径，**不需要** `/zhin/` 前缀）。深链刷新依赖 `404.html` SPA fallback（见 `packages/console-app/scripts/prepare-github-pages.mjs`）。
2. 登录页填写 **API Base URL**（你的 Zhin Host，如 `http://127.0.0.1:8086`）与 **Bearer Token**（`zhin.config` / `.env` 中 `http.token` 或 `HTTP_TOKEN`）。
3. Host 需在 `zhin.config` 中配置 `http.corsOrigins`，包含 Console 页面的 **Origin**（仅 scheme+host，无路径），例如：

```yaml
http:
  port: 8086
  token: your-token
  corsOrigins:
    - "https://console.zhin.dev"
```

若仍使用默认项目地址 `https://zhinjs.github.io/zhin/`，在仓库 **Settings → Secrets and variables → Actions → Variables** 设置 `CONSOLE_PAGES_BASE=/zhin` 后重新部署。

协议：REST `POST /api/console/request` + SSE `GET /api/events`（见 ADR `docs/adr/0008-host-edge-remote-console.md`）。

自托管：在仓库根执行 `pnpm --filter @zhin.js/console-app build`，将 `packages/console-app/dist/` 部署到任意静态主机（本地预览：`pnpm --filter @zhin.js/console-app preview:remote` → http://127.0.0.1:5173），同样配置 API Base。勿对 `plugins/services/console/client` 使用 Vite（该路径无独立构建配置）。
