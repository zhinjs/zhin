# Docker / 容器部署

> **当前状态（2026-07）**：仓库**不提供**官方预构建镜像。此前 `.github/workflows/docker.yml` 仅完成 login/metadata、**未** build/push，已删除以免造成假安全感。

## 推荐做法

1. 本机或 CI 使用 [create-zhin-app](https://www.npmjs.com/package/create-zhin-app) / [快速开始](/getting-started/) 生成项目；
2. 需要容器时，在**你的应用仓库**自写 `Dockerfile`（`node:22` + `pnpm install` + `pnpm start`），自行推送到私有或公共 registry。

## 自建 Dockerfile 示意

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["pnpm", "start"]
```

生产请 pin `zhin.js` / `@zhin.js/*` 精确版本；脚手架默认 `latest` 仅适合试玩。

## 相关

- [快速开始](/getting-started/)
- [能力分档](/essentials/capability-tiers)
- ADR 0014（nightly / 长压）— 深度验收见 `pnpm check:l4`（nightly workflow）
