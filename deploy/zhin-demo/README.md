# zhin-demo 部署包

官方在线 Demo：**demo.zhin.dev**（Console）+ **demo-api.zhin.dev**（Host + Ollama）。

本目录为独立仓库 `zhin-demo` 的 monorepo 内源模板；发布时可 `git subtree split` 或复制到 [github.com/zhinjs/zhin-demo](https://github.com/zhinjs/zhin-demo)。

## 架构

```text
demo.zhin.dev          → 静态 Console（Demo profile，Token 编译进构建）
demo-api.zhin.dev      → Nginx → Zhin Host (examples/demo-bot) + Ollama
```

## 快速开始（VPS）

```bash
cp deploy/zhin-demo/.env.example deploy/zhin-demo/.env
# 编辑 ADMIN_TOKEN、DEMO_TOKEN、域名证书路径

cd deploy/zhin-demo
docker compose up -d
```

## 目录

| 路径 | 说明 |
|------|------|
| [docker-compose.yml](./docker-compose.yml) | Host + Ollama + Nginx |
| [nginx.conf](./nginx.conf) | 双域反代 + rate limit |
| [console/](./console/) | Demo Console 构建说明与最小壳 |
| [docs/RUNBOOK.md](./docs/RUNBOOK.md) | Token 轮换、监控、GPU |

Demo 页 header 提供双 CTA：**部署到本机**（first-run 文档）与 **接 QQ Bot**（ICQQ 适配器文档）。首次访问展示 **3 步 Demo onboarding**（无需登录，见 [console/README.md](./console/README.md)）。

## 相关

- Host 配置：[examples/demo-bot](../../examples/demo-bot/)
- ADR：[docs/adr/0016-demo-host-token-scopes.md](../../docs/adr/0016-demo-host-token-scopes.md)
