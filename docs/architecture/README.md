# 架构文档索引

本目录是 Zhin.js **架构与契约** 的入口。修改 IM 消息链或出站路径时，先读此处再改代码。

> 项目的定位与边界宣言见 [路线与边界（Vision）](../vision.md)。

## IM 主栈（Stable）

默认开发与对外承诺范围以 [examples/minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 为准（**IM 核心**；AI 见 [ADR 0019](../adr/0019-install-size-layering.md) 与 [full-bot](https://github.com/zhinjs/zhin/tree/main/examples/full-bot)）。

| 文档 | 说明 |
|------|------|
| [Plugin-first 目标架构 SSOT](../target-architecture.md) | TypeScript/HMR Plugin 树、PluginScope、基础 Resource、Capability、Runtime Authority 与流程图 |
| [目标技术实现蓝图](target-implementation/) | 规范性模块分层、依赖预算与关键 TypeScript 实现 |
| [Plugin Monorepo 与 Feature Provider](target-implementation/plugin-monorepo-and-features.md) | 一级 workspace、静态 package graph、可发布 Feature contract 与 CLI pipeline |
| [Plugin Runtime 实现状态](target-implementation/greenfield-bootstrap.md) | 正式 Runtime 已实现链路、验证与明确迁移边界 |
| [Plugin Runtime 原位迁移](target-implementation/in-place-migration.md) | Stable ownership、替换顺序与完成定义 |
| [Plugin Runtime 迁移契约](target-implementation/migration-contract.md) | AST inventory/extraction、compat 边界、cutover 与 API 冻结 |
| [ADR 0051 — Node 原生 TypeScript Runtime](../adr/0051-native-typescript-development-runtime.md) | 零编译依赖启动、原生 TS 约束、HMR 与 process restart 边界 |
| [ADR 0052 — Plugin Runtime 包边界](../adr/0052-plugin-runtime-package-boundary.md) | 新底座与旧 Kernel 解耦，保持零生产依赖与可迁移性 |
| [架构概览](../architecture-overview.md) | 分层（basic → kernel → ai → core → agent → zhin）、消息流程图 |
| [Segment 内容模型](segment-content-model.md) | **SSOT**：`Segment[]` 形状、MediaRef、IM 可见性、AI 出站 JSON |
| [ADR 0019 — 安装体积分层](../adr/0019-install-size-layering.md) | zhin.js 4.x：IM <10MB、agent/provider optional peer |
| [ADR 0009 — agentLoop 统一栈](../adr/0009-pi-aligned-ai-agent-core.md) | Context + stream + agentLoop 迁移与完成定义 |
| [仓库结构](../contributing/repo-structure.md) | pnpm workspace、`src→lib` / `client→dist` |
| [Harness 工程](../contributing/harness-engineering.md) | 发送链路、层级依赖、CI 检查 |
| [文档片段 `snippets/`](https://github.com/zhinjs/zhin/blob/main/docs/snippets/README.md) | Install tiers 等 VitePress 可复用 SSOT（`srcExclude`，站内无页面） |
| [AI 模块](../advanced/ai.md) | 安装分层、`agents` 绑定、模型发现、`im_transcripts` / `agent_messages` |
| [packages 子包 README](https://github.com/zhinjs/zhin/blob/main/packages/README.md) | `im/ai`、`im/agent`、`im/core`、`im/zhin` 包内说明 |
| [Agent 上下文块](agent-context-blocks.md) | 系统提示词分段与贡献者约定 |
| [Agent 提示词贡献者](agent-prompt-contributors.md) | 平台专属 `AgentPromptContributor` |
| [HTTP 路由编写](fetch-router-authoring.md) | Koa `Router` / `registerFetchRoute` 兼容 API |
| [Assistant Runtime 演进路线图](assistant-runtime.md) | 个人助手（路线 A）：JobStore、Event Ingress、通知与 Home Domain |

根目录 [AGENTS.md](https://github.com/zhinjs/zhin/blob/main/AGENTS.md) 为 AI 编码代理的最小入口。

## 代码锚点

| 用途 | 路径 |
|------|------|
| 插件 / 命令 / 中间件 | `packages/im/core/src/plugin.ts` |
| 适配器与发送 | `packages/im/core/src/adapter.ts` |
| 消息调度 | `packages/im/core/src/built/dispatcher.ts` |
| 出站字段规范化（cron 等） | `packages/im/core/src/built/queue-im-field-contract.ts` |
| Agent 编排 | `packages/im/agent/src/orchestrator/` |
| LLM 统一栈 | `packages/im/ai/src/llm/`（`agentLoop`、`register-api-layer`） |
| Turn 执行器 | `packages/im/agent/src/zhin-agent/agent-loop-turn.ts`、`agent-loop-standalone.ts` |
| 安全策略 | `packages/im/agent/src/security/` |
| 遗留 Agent 类 | `packages/im/ai/src/agent/`（单测 / 直接 import） |
| IM 落库 | `packages/im/zhin/src/setup/register-chat-message-store.ts` |
| ApiRegistry / getModel | `packages/im/ai/src/llm/api-registry.ts` |
| Host Router | `packages/host/router/src/` |
| Host API | `packages/host/api/src/` |
