# Zhin Console Site

Remote Console **静态 UI** 与 [zhin](https://github.com/zhinjs/zhin) 主仓库分离部署，避免与 VitePress 文档站抢占同一 GitHub Pages。

- **推荐域名**：`https://console.zhin.dev`（仓库 Settings → Pages → Custom domain）
- **文档站**：仍在主仓库 `deploy-docs.yml` → `https://zhin.pages.dev`
- **Host API**：用户自托管 Zhin（`http://127.0.0.1:8086` 等），见 [docs/console-remote.md](https://github.com/zhinjs/zhin/blob/main/docs/console-remote.md)

## 创建 `zhinjs/zhin-console` 仓库

```bash
# 1. 在 zhin monorepo 同步 UI 源码
cd /path/to/zhin
node console-site/scripts/sync-from-zhin.mjs

# 2. 推到新仓库（首次）
cd console-site
git init
git add .
git commit -m "chore: bootstrap zhin-console site"
git remote add origin git@github.com:zhinjs/zhin-console.git
git push -u origin main
```

后续 UI 改动在 **zhin monorepo** 的 `packages/console-app/client` 与 `plugins/services/console/client` 开发，发版前再跑一次 `sync` 并提交到 `zhin-console`。

## 本地开发

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173 ，代理到 VITE_DEV_API（默认 8086）
pnpm build
pnpm preview
```

登录页填写 Host **API Base** + **Token**；`corsOrigins` 需含 `https://console.zhin.dev`。

## 与 monorepo 的关系

| 位置 | 职责 |
|------|------|
| `zhin` monorepo | Console **协议**、Host、`@zhin.js/console-core`、`@zhin.js/client`、插件 `@dev` 打包 |
| `zhin-console` 本仓库 | 仅 **静态站** 构建与 Pages；可日后将 Farm 换成 Vite 而不动主仓库 |

`@zhin.js/*` 依赖从 npm 安装；未发布前可在 `package.json` 改用 `pnpm add github:zhinjs/zhin#path:packages/client` 等（见 pnpm [git 依赖](https://pnpm.io/git)）。

## CI

`.github/workflows/pages.yml`：push `main` 即部署。变量（可选）：

- `CONSOLE_PAGES_CNAME` — 默认 `console.zhin.dev`
- `CONSOLE_PAGES_BASE` — 自定义域留空；仅 `*.github.io/<repo>/` 时设为 `/zhin-console`

## 迁到 Vite（以后）

本目录仅含 `farm.config.ts` + `client/` + `console-ui/`，替换构建工具时不影响 zhin Host。新建 `vite.config.ts`、`index.html` 复用相同 alias（`@console` → `console-ui/src`）即可。
