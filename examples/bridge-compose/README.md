# Bridge v1 可选 Compose（Q3）

## Optional, non-blocking（Q3）

This example is **not** required for Bridge v1, **not** wired into core zhin CI, and does not ship a first-party zhin image. Treat it as copy-paste scaffolding only.

## 可选、非阻塞

本目录**不**参与 zhin 核心 CI；v1 不强制 Docker 部署。若你在容器内跑 zhin + 胶水子进程，请 **自备镜像（BYO）** 与编排。

## 使用方式

1. 阅读 [`docker-compose.yml`](./docker-compose.yml) 内的注释。
2. 将 `zhin` 服务镜像替换为你的构建产物（例如私有 registry 中的 `your/zhin-bot:tag`）。
3. 通过 **`env_file` 或编排密钥** 注入 `ZHIN_BRIDGE_IPC_TOKEN` 等变量（**不要**把 token 写进提交到 git 的 compose 文件）。

## 与主文档的关系

编排细节以你的环境为准；概念与包列表见 [Bridge v1 开发者指南](../../docs/bridge/index.md)。
