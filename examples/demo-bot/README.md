# demo-bot（官方在线 Demo Host 配置）

[demo-api.zhin.dev](https://demo-api.zhin.dev) 托管实例的配置模板：Sandbox + hello + `ai:`（Ollama），**Demo scoped Token** 供 [demo.zhin.dev](https://demo.zhin.dev) Console 使用。

本地开发对照 [minimal-bot](../minimal-bot/)；部署见 [deploy/zhin-demo](../../deploy/zhin-demo/README.md)。

## 与 minimal-bot 差异

| 项 | demo-bot |
|----|----------|
| `http.host` | `0.0.0.0` |
| `http.tokens[]` | `scope: demo` 公开 Token |
| `http.corsOrigins` | `https://demo.zhin.dev` |
| `http.trustProxy` | `true`（Nginx 反代） |

## 本地试跑

```bash
# 仓库根已 pnpm install && pnpm build
cd examples/demo-bot
cp .env.example .env
pnpm dev
```

- Host：`http://127.0.0.1:8086`
- 全权限 Token：`.env` 的 `ADMIN_TOKEN`
- Demo Token：`.env` 的 `DEMO_TOKEN`（模拟前端公开凭证）

用 Demo Token 调 `POST /api/console/request`：`ping` 应成功，`config:save-yaml` 应 403。

## 文档

- [ADR 0016 — Demo Host Token 作用域](../../docs/adr/0016-demo-host-token-scopes.md)
- [Remote Console](../../docs/console-remote.md)
