# 生态与资源

本页汇总 **部署入口、平台适配、插件与社区资源**，叙事方式对齐成熟 IM 框架文档：首页讲价值，本页讲「接什么、去哪找」。

## 三种运行入口

| 入口 | 说明 | 链接 |
|------|------|------|
| **在线 Sandbox** | 零安装，浏览器内发消息 | [demo.zhin.dev](https://demo.zhin.dev) |
| **项目脚手架** | 独立仓库，`pnpm dev` 本地 Host | `npm create zhin-app -y` · [快速开始](/getting-started/) |
| **Monorepo 示例** | 贡献者与深度调试 | [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot)（Stable）· [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot)（厨房水槽） |

## 平台适配器

Zhin 通过 **Adapter + Endpoint** 连接各 IM 平台。与 [NapCatQQ](https://napneko.github.io/) 等协议端配合时，通常流程为：

1. 部署协议端（如 NapCat / OneBot）或使用官方 Bot API
2. `npx zhin install @zhin.js/adapter-*` 安装适配器
3. `npx zhin setup --adapters` 写入 `zhin.config.yml`

| 档位 | 含义 | 索引 |
|------|------|------|
| **Stable** | 首跑与 CI 默认路径 | [Sandbox](/adapters/sandbox) |
| **Advanced** | 常用生产平台 | [适配器目录](/adapters/) |
| **Experimental** | 需自行验证部署差异 | 同目录 Experimental 区 |

框架级概念（多 Endpoint、capabilities）见 [适配器概览](/essentials/adapters)。

## 插件与扩展

| 类型 | 说明 |
|------|------|
| [插件市场](/plugins/) | 官方与社区插件浏览、搜索 |
| [安装插件](/guide/plugin-install) | `zhin install` 与配置启用 |
| [插件开发](/guide/plugin-development) | 从脚手架到测试、发布 |

服务类插件（数据库、Host 等）位于 monorepo `plugins/services/`，适配器位于 `plugins/adapters/`。

## Console 与 Host

| 组件 | 作用 |
|------|------|
| **Host API** | 本地 `:8086`，管理 bot、插件、Console 协议 |
| **Remote Console** | [console.zhin.dev](https://console.zhin.dev) 连接 Host，Sandbox 聊天与配置 |
| [Host 栈概览](/host/) | router / api / mcp 分工 |

## AI 与 Agent（可选）

| 档位 | 安装 | 文档 |
|------|------|------|
| IM 核心 | `zhin.js` | [快速开始](/getting-started/) |
| AI 栈 | `+ @zhin.js/agent zod ai` | [AI 模块](/advanced/ai) |
| Provider | `+ @ai-sdk/*` | [配置向导](/essentials/configuration) |
| MCP | `+ @modelcontextprotocol/sdk` | [MCP 集成](/advanced/mcp) |

分档表 SSOT：[Install tiers](/getting-started/#install-tierszhinjs-4x)。

## 学习路径

不必一次读完所有文档：

1. **L1** — [快速开始](/getting-started/) → [消息流转](/essentials/message-flow)
2. **L2** — [插件开发](/guide/plugin-development) → [命令](/essentials/commands)
3. **L3** — [架构概览](/architecture-overview) → [AI 模块](/advanced/ai)
4. **L4** — [Agent Mesh](/advanced/agent-mesh) · [full-bot 示例](https://github.com/zhinjs/zhin/tree/main/examples/full-bot) · [五角色群协作（高级）](/advanced/five-agent-recipe)

详见 [学习路径](/essentials/learning-paths)。

## 社区与源码

- **GitHub**：[zhinjs/zhin](https://github.com/zhinjs/zhin)
- **Issue / PR**：[Issue 流程](/agents/issue-tracker)（贡献者）
- **变更记录**：[CHANGELOG](/CHANGELOG)
