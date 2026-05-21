# Host 端到端：Remote Console 验收

Host **不再**提供 `http://<host>:8086/console` 静态 UI，仅保留 Console **API**（`/entries`、`/api/console/*`、`/api/events` 等）。UI 在独立仓库 **[zhinjs/zhin-console](https://github.com/zhinjs/zhin-console)** 构建与预览。

## 1. Host 配置（`zhin.config.yml`）

```yaml
http:
  port: 8086
  token: <与 .env HTTP_TOKEN 一致>
  corsOrigins:
    - "http://127.0.0.1:5173"
    - "https://console.zhin.dev"
```

## 2. 启动 Host（本仓库）

```bash
cd examples/test-bot
pnpm dev
```

日志应含 `console` / `api_only`。

## 3. Remote Console UI（zhin-console 仓库）

在 **zhin-console** 工程中：

```bash
pnpm install
pnpm dev          # 或 preview，见该仓库 README
```

浏览器打开开发地址（通常 `http://127.0.0.1:5173`），登录：

| 字段 | 值 |
|------|-----|
| API Base URL | `http://127.0.0.1:8086` |
| Token | `HTTP_TOKEN` |

验收：登录、bot 列表、发消息、插件市场、配置页；Network 中 API 指向 **8086**（含 `/entries`、`/api/console/request`、`/api/events`）。

## 4. IndexedDB

刷新后收件箱/列表仍可用。

## 5. 线上

**https://console.zhin.dev**（`zhin-console` GitHub Pages）。

详见 [docs/console-remote.md](../../docs/console-remote.md).
