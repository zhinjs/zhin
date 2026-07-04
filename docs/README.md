# @zhin.js/docs

[zhinjs.github.io](https://zhinjs.github.io/zhin/) 文档站点源码（[VitePress](https://vitepress.dev/)）。本 workspace 包为 **private**，不发布 npm。

## 文档分区（双 IA）

顶栏分为两套导航，**URL 路径不变**：

| 分区 | 读者 | 典型路径 |
|------|------|----------|
| **使用文档** | 部署 bot、写插件/命令/AI | `getting-started/`、`essentials/`、`guide/`、`adapters/`、`advanced/` |
| **框架开发** | 贡献 monorepo、读 ADR | `contributing/`、`architecture/`、`adr/`、`agents/` |

侧栏在各自分区内统一展开；灰区页面（如 [架构概览](/architecture-overview)）主归属使用文档，框架开发侧栏保留交叉链接。

## 本地开发

在仓库根目录：

```bash
pnpm docs:dev
```

仅启动 VitePress 开发服（不重新生成 API 参考）。

## 完整构建

与 CI / GitHub Pages 一致：

```bash
pnpm docs:build
```

依次执行：`typedoc`（生成 `docs/api/`）→ `sync:adapter-docs` → `vitepress build`。

预览构建产物：

```bash
pnpm docs:preview
```

## 目录

| 路径 | 说明 |
|------|------|
| `index.md` | 站点首页 |
| `getting-started/` | 入门 |
| `essentials/` | 核心概念 |
| `advanced/` | AI、Schedule、MCP 等进阶 |
| `adr/` | 架构决策记录 |
| `adapters/` | 平台适配器（部分由 `pnpm sync:adapter-docs` 同步） |
| `.vitepress/config.ts` | 侧栏与站点配置 |

## 相关

- 仓库根 [README.md](https://github.com/zhinjs/zhin/blob/main/README.md)
- [Harness Engineering](./contributing/harness-engineering.md) — `pnpm check:doc-links`
