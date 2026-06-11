# Demo Console（demo.zhin.dev）

独立 Console 构建，预连 `demo-api.zhin.dev` + Demo scoped Token。

## 方案 A — zhin-console Demo profile（推荐生产）

在 [zhin-console](https://github.com/zhinjs/console) 仓库增加 build profile：

```bash
VITE_API_BASE=https://demo-api.zhin.dev \
VITE_API_TOKEN=<DEMO_TOKEN> \
VITE_DEMO_MODE=1 \
pnpm build
```

**`VITE_DEMO_MODE=1` 行为（需在 zhin-console 实现）：**

1. 启动时写入 `localStorage`：`zhin_api_base`、`zhin_api_token`
2. 跳过登录页，默认路由 `/console/sandbox`
3. 隐藏配置/文件/cron/env 管理页
4. 顶栏 CTA：`npm create zhin-app` → https://zhin.js.org/getting-started/

参考 monorepo SDK 键名：[packages/console/client/client/websocket/remote-settings.ts](../../packages/console/client/client/websocket/remote-settings.ts)

## 方案 B — 最小静态壳（本目录 `minimal/`）

无 zhin-console 依赖时的 MVP：单页 iframe/跳转 Remote Console + 预填脚本。

```bash
cd deploy/zhin-demo/console/minimal
cp .env.example .env
pnpm install && pnpm build
# 产物 dist/ → docker compose nginx 挂载
```

## 构建产物

`dist/` 目录由 CI 生成，挂载到 [nginx.conf](../nginx.conf) 的 `/usr/share/nginx/demo-console`。
