# Remote Console（独立静态站）

Zhin Host **不提供** `/console` 静态页，仅提供 Console API。官方 UI 在独立仓库 **[zhinjs/console](https://github.com/zhinjs/console)** 维护并部署（如 `console.zhin.dev`），与 VitePress 文档站（`zhin.pages.dev`）分离。

本 monorepo 可选以 **git submodule** 挂载在 **`zhin-console/`**（`git clone --recurse-submodules` 或 `git submodule update --init zhin-console`），便于与 Host 联调；发布仍以独立仓库为准。

## 使用方式

1. 打开 **https://console.zhin.dev**（或你在 `zhin-console` 仓库配置的域名）。
2. 登录页填写 **API Base URL**（你的 Zhin Host，如 `http://127.0.0.1:8086`）与 **Bearer Token**（`zhin.config` / `.env` 中 `http.token` 或 `HTTP_TOKEN`）。
3. Host 默认已在 `http.corsOrigins` 中加入 **`https://console.zhin.dev`**（`@zhin.js/host-router`）。本地开发 **zhin-console** 时可在 `zhin.config` 追加其它 Origin，例如：

```yaml
http:
  port: 8086
  token: your-token
  corsOrigins:
    - "http://127.0.0.1:5173"
```

启动后日志会输出带 `apiBaseUrl` 的 Console 打开链接（Token 在 Console 登录页填写，勿通过 URL 传递）。

协议：REST `POST /api/console/request` + SSE `GET /api/events`（Node Host）。

Host 启动后可在 **`GET {API Base URL}/pub/openapi.json`** 获取当前实例的 **OpenAPI 3.1** 路由清单（无需 Token），便于 Console 与插件按运行时能力自适应。日志字段 `openapi` 为同地址。插件注册路由时可追加可选元数据对象（`summary`、`tags` 等），见 `@zhin.js/host-router/router` 的 `RouteMeta`。

## 仓库分工

| 仓库 | 内容 |
|------|------|
| **zhin**（本仓库） | Host：`@zhin.js/host-router`（传输）、`@zhin.js/host-api`（管理面 API）、`@zhin.js/pagemanager`；契约：`@zhin.js/contract`；Remote SDK：`@zhin.js/client` |
| **zhin-console** | 全部 Console **UI**（壳 + 内置页 + 构建/Farm 或未来 Vite） |

本地验收 Host API：见 `examples/test-bot/REMOTE_CONSOLE.md`（在 **zhin-console** 工程里 `pnpm dev` / `pnpm build`）。
