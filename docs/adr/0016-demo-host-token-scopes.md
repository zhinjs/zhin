---
sidebar: false
---

# Demo Host Token 作用域（demo.zhin.dev）

为公开在线 Demo 提供 **作用域受限** 的 Bearer Token，避免将编译进前端的 Token 等同于全权限 Host 凭证。

## 状态

已接受（2026-06-10）· **实现中**

## 背景

[demo.zhin.dev](https://demo.zhin.dev) 引流方案需要在浏览器中预填 API Base 与 Demo Token（见 [营销分镜](../marketing/bilibili-first-run-storyboard.md)）。当前 Host 仅支持 **单一全权限 Token**（`http.token`），Console RPC 含 `config:save-yaml`、`files:save`、`cron:add` 等写操作。若 Demo Token 泄露，攻击者可改配置、读 `.env`、滥用 AI。

## 决策

### D1 — 多 Token + scope

`http.token` 保持 **full** 作用域（运维 / 自托管）。可选 `http.tokens[]` 附加 scoped token：

```yaml
http:
  token: ${ADMIN_TOKEN}
  tokens:
    - token: ${DEMO_TOKEN}
      scope: demo
  corsOrigins:
    - "https://demo.zhin.dev"
```

解析与校验在 `@zhin.js/host-router`；RPC/REST 门禁在 `@zhin.js/host-api`。

### D2 — demo 作用域白名单（最窄）

**允许**

| 类型 | 路径 / RPC |
|------|------------|
| HTTP GET | `/pub/*`、`/entries`、`/entries/*`、`/@dev/*`、`/@assets/*` |
| HTTP GET | `{base}/events`（SSE） |
| HTTP POST | `{base}/console/request`（RPC 再过滤） |
| WebSocket | `/sandbox` |
| Console RPC | `ping`、`entries:get`、`endpoint:list`、`endpoint:info`、`endpoint:sendMessage` |

**拒绝**（403，`Demo scope: forbidden`）

- 所有 `config:*` 写、`files:save`、`env:save`、`cron:add|remove|pause|resume`
- 所有 `db:*`
- 其余 REST（`/api/plugins`、`/api/config`、marketplace、logs 等）

### D3 — 威胁模型

| 风险 | 缓解 |
|------|------|
| Demo Token 从前端 JS 提取 | scope 白名单；不可改配置/读 env |
| LLM 滥用 | 边缘 rate limit + Ollama 并发（部署层，见 zhin-demo RUNBOOK） |
| 多访客串话 | Sandbox `randomNamePerConnection` → 独立 `sandbox-{id}` |
| Token 长期泄露 | CI 轮换 `DEMO_TOKEN` 并重编 demo Console |

### D4 — 域名与 CORS

- **demo.zhin.dev** — Demo Console 静态站
- **demo-api.zhin.dev** — 托管 Host + Ollama
- Demo Host 必须在 `http.corsOrigins` 包含 `https://demo.zhin.dev`

### D5 — 刻意不做（v1）

- URL 传 Token（违反 [Console 需求](../console/requirements.md) §2.1）
- demo scope 访问 MCP、bash、config 写
- 多 Profile（Stable/Advanced）切换

## 后果

- `@zhin.js/host-router` 增加 `TokenRegistry`、`demo-scope` 模块与测试
- `@zhin.js/host-api` Console dispatch 需读取 `ctx.state.authScope`
- Sandbox 客户端跨域 WS 需在 query 附带 `token`（浏览器无法可靠带 Authorization）
- 官方 Demo 配置见 [examples/demo-bot](https://github.com/zhinjs/zhin/tree/main/examples/demo-bot)

## 相关

- [Remote Console](../console-remote.md)
- [Console 需求](../console/requirements.md)
- [zhin-demo 部署](https://github.com/zhinjs/zhin/blob/main/deploy/zhin-demo/README.md)
