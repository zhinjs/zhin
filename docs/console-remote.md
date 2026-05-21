# Remote Console（独立静态站）

Zhin Host **不提供** `/console` 静态页，仅提供 Console API。官方 UI 在独立仓库 **[zhinjs/zhin-console](https://github.com/zhinjs/zhin-console)** 维护并部署（如 `console.zhin.dev`），与 VitePress 文档站（`zhin.pages.dev`）分离。

## 使用方式

1. 打开 **https://console.zhin.dev**（或你在 `zhin-console` 仓库配置的域名）。
2. 登录页填写 **API Base URL**（你的 Zhin Host，如 `http://127.0.0.1:8086`）与 **Bearer Token**（`zhin.config` / `.env` 中 `http.token` 或 `HTTP_TOKEN`）。
3. Host 默认已在 `http.corsOrigins` 中加入 **`https://console.zhin.dev`**（`@zhin.js/http`）。本地开发 **zhin-console** 时可在 `zhin.config` 追加其它 Origin，例如：

```yaml
http:
  port: 8086
  token: your-token
  corsOrigins:
    - "http://127.0.0.1:5173"
```

启动后日志会输出带 `apiBaseUrl` 的 Console 打开链接（Token 在 Console 登录页填写，勿通过 URL 传递）。

协议：REST `POST /api/console/request` + SSE `GET /api/events`（见 ADR `docs/adr/0008-host-edge-remote-console.md`）。

## 仓库分工

| 仓库 | 内容 |
|------|------|
| **zhin**（本仓库） | Host：`@zhin.js/console` 服务、`@zhin.js/console-core`（PageManager、`/@dev` 打包）、`@zhin.js/client`（Remote SDK，供 UI 依赖） |
| **zhin-console** | 全部 Console **UI**（壳 + 内置页 + 构建/Farm 或未来 Vite） |

本地验收 Host API：见 `examples/test-bot/REMOTE_CONSOLE.md`（在 **zhin-console** 工程里 `pnpm dev` / `pnpm build`）。
