# Demo Console（demo.zhin.dev）

**生产路径（方案 A）**：在 [zhin-console](https://github.com/zhinjs/console) 仓库用 **`VITE_DEMO_MODE=1`** 构建并部署到 `demo.zhin.dev`。详见 console 仓库 [README](https://github.com/zhinjs/console#demo-站点demozhindev) 与 **`.github/workflows/demo-pages.yml`**。

**Host 侧**：本目录 `docker-compose` 部署 **`demo-api.zhin.dev`**（`examples/demo-bot` + Ollama），与 Console 构建分离。

## 方案 A — zhin-console Demo profile（推荐生产）

```bash
# console 仓库
VITE_DEMO_MODE=1 \
VITE_API_BASE=https://demo-api.zhin.dev \
VITE_API_TOKEN=<DEMO_TOKEN> \
pnpm build:demo
```

**`VITE_DEMO_MODE=1` 行为（已在 zhin-console 实现）：**

1. 启动时写入 `localStorage`：`zhin_api_base`、`zhin_api_token`
2. 跳过登录页，默认路由 `/sandbox`
3. 隐藏 env/文件/cron/市场 等写操作页；**配置页只读**（可查看，不可保存）
4. 顶栏双 CTA + onboarding；**概览页无「重启服务」**

## 方案 B — 最小静态壳（`minimal/`，仅 fallback）

无 zhin-console 时的 MVP；**官方 demo.zhin.dev 应使用方案 A**。方案 B 保留供自托管或 nginx 直挂静态页：

```bash
cd deploy/zhin-demo/console/minimal
cp .env.example .env
pnpm install && pnpm build
```

## 构建产物（方案 B）

`minimal/dist/` 由 CI 生成，可挂载到 [nginx.conf](../nginx.conf) 的 `/usr/share/nginx/demo-console`（若不用 GitHub Pages 部署 Console）。
