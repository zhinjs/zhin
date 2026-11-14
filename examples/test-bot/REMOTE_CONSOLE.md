# Host 端到端：Remote Console 验收

Host **不再**提供 `http://<host>:8068/console` 静态 UI，仅保留 Console **API**（`/entries`、`/api/console/*`、`/api/events` 等）。UI 在独立仓库 **[zhinjs/zhin-console](https://github.com/zhinjs/zhin-console)** 构建与预览。

## 1. Host 配置（`zhin.config.yml`）

```yaml
http:
  port: 8068
  token: <与 .env HTTP_TOKEN 一致>   # 初始化令牌：只用于创建第一个所有者
  corsOrigins:
    - "http://127.0.0.1:5173"
    - "https://console.zhin.dev"
```

## 2. 启动 Host（本仓库）

```bash
cd examples/test-bot
pnpm dev
```

日志应含 Host HTTP 启动信息，以及 Host API 的 `服务: Host API`、`模式: 仅API`（或等价 `[Zhin:host-api]` 行）。

## 3. Remote Console UI（zhin-console 仓库）

在 **zhin-console** 工程中：

```bash
pnpm install
pnpm dev          # 或 preview，见该仓库 README
```

浏览器打开开发地址（通常 `http://127.0.0.1:5173`），API Base URL 填 `http://127.0.0.1:8068`：

1. 第一次连接（还没有所有者）：用 `HTTP_TOKEN` 进入初始化向导，创建所有者账号；也可以先在 `examples/test-bot` 运行 `pnpm exec zhin console init`。
2. 之后用账号登录；初始化令牌在所有者创建后失效。只读验收可另建 `viewer` 账号：`pnpm exec zhin console user create viewer --role viewer`。

验收：登录、bot 列表、发消息、插件市场、配置页；Network 中 API 指向 **8068**（含 `/entries`、`/api/console/request`、`/api/events`）。

## 4. IndexedDB

刷新后收件箱/列表仍可用。

## 5. 线上

**https://console.zhin.dev**（`zhin-console` GitHub Pages）。

详见 [docs/console/index.md](../../docs/console/index.md).
