# Remote Console（GitHub Pages）

Zhin Host **不提供** `/console` 静态页，仅提供 Console API。官方 UI 通过 GitHub Pages 发布（见 workflow `console-pages.yml`）。使用方式：

1. 打开 Pages URL（release 后于 Actions 部署页查看）。
2. 登录页填写 **API Base URL**（你的 Zhin Host，如 `http://127.0.0.1:8086`）与 **Bearer Token**（`zhin.config` / `.env` 中 `http.token` 或 `HTTP_TOKEN`）。
3. Host 需在 `zhin.config` 中配置 `http.corsOrigins`，包含 Pages 源，例如：

```yaml
http:
  port: 8086
  token: your-token
  corsOrigins:
    - "https://zhinjs.github.io"
```

协议：REST `POST /api/console/request` + SSE `GET /api/events`（见 ADR `docs/adr/0008-host-edge-remote-console.md`）。

自托管：在仓库根执行 `pnpm --filter @zhin.js/console-app build`，将 `packages/console-app/dist/` 部署到任意静态主机（本地预览：`pnpm --filter @zhin.js/console-app preview:remote` → http://127.0.0.1:5173），同样配置 API Base。勿对 `plugins/services/console/client` 使用 Vite（该路径无独立构建配置）。
