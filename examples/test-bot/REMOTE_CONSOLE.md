# Host 端到端：Remote Console 验收

Host **不再**提供 `http://<host>:8086/console` 静态 UI，仅保留 Console **API**（`/entries`、`/api/console/*`、`/api/events` 等）。UI 使用 Remote 静态站（本地 5173 或 GitHub Pages）。

## 1. Host 配置（`zhin.config.yml`）

```yaml
http:
  port: 8086
  token: <与 .env HTTP_TOKEN 一致>
  corsOrigins:
    - "http://127.0.0.1:5173"
    - "https://zhinjs.github.io"
```

## 2. 构建 Console 静态 UI

```bash
pnpm --filter @zhin.js/console-app build
```

## 3. 启动 Host

```bash
cd examples/test-bot
pnpm dev
```

日志应含 `console` / `api_only`，**不应**再依赖访问 `:8086/console`。

## 4. Remote Console（跨源）

```bash
pnpm --filter @zhin.js/console-app preview:remote
```

浏览器 **http://127.0.0.1:5173**（路由为 `/dashboard`、`/marketplace` 等，**无** `/console` 前缀）：

| 字段 | 值 |
|------|-----|
| API Base URL | `http://127.0.0.1:8086` |
| Token | `HTTP_TOKEN` |

验收：登录、bot 列表、发消息、插件市场、配置页；Network 中 API 指向 **8086**（含 `/entries`、`/api/console/request`、`/api/events`）。

## 5. IndexedDB

刷新后收件箱/列表仍可用。

## GitHub Pages（可选）

`console-pages.yml` 或 release 后，Pages URL + 同上 API Base；`corsOrigins` 含 Pages origin。

详见 [docs/console-remote.md](../../docs/console-remote.md).
