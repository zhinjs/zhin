# 架构文档索引

本目录是 Zhin.js **架构与契约** 的入口。修改 IM 消息链、出站路径或队列字段时，先读此处再改代码。

## IM 主栈（Stable）

默认开发与对外承诺范围以 [examples/minimal-bot](../../examples/minimal-bot/) 为准。

| 文档 | 说明 |
|------|------|
| [架构概览](../architecture-overview.md) | 分层（basic → kernel → ai → core → agent → zhin）、消息流程图 |
| [仓库结构](../contributing/repo-structure.md) | pnpm workspace、`src→lib` / `client→dist` |
| [Harness 工程](../contributing/harness-engineering.md) | 发送链路、层级依赖、CI 检查 |
| [事件契约](event-contracts.md) | 队列事件 kind / type / detail 推荐形状 |
| [Agent 上下文块](agent-context-blocks.md) | 系统提示词分段与贡献者约定 |
| [IM ↔ 队列出站不变量](im-queue-outbound-invariants.md) | 队列 detail 与 Core `SendOptions` 对齐 |

根目录 [AGENTS.md](../../AGENTS.md) 为 AI 编码代理的最小入口。

## 队列 / qbot（Beta）

`packages/queue-runtime` 与 IM 主栈**平行**，不经 `MessageDispatcher`。业务出站入口为 `enqueueOutgoing` → `claimOutgoing` → `executeOutbound`，勿与 IM 的 `Message.$reply` / `Adapter.sendMessage` 混为一谈。

| 文档 | 说明 |
|------|------|
| [Queue 路线图（Beta）](queue-roadmap.md) | 目标、非目标、配置现状、验收命令 |
| [Queue 术语与关系](queue/CONTEXT.md) | Envelope、Outbound Detail、Field Contract 等统一词汇 |
| [队列 ↔ IM 字段契约](queue-im-field-contract.md) | 字段别名与规范化规则 |

黄金路径示例：[examples/minimal-qbot](../../examples/minimal-qbot/)。**非** Stable 默认首跑（首跑仍用 minimal-bot）。

## 已移除的文档路径（勿再引用）

以下文件名曾出现在 AI 规则或旧草稿中，**仓库内不存在**，请改链到本页：

- `roadmap-queue-ai.md`
- `queue-first-evolution.md`
- `unified-config.md`
- `outbound-queue-mode.md`
- `queue-plugin-authoring.md`

## 代码锚点

| 用途 | 路径 |
|------|------|
| 插件 / 命令 / 中间件 | `packages/core/src/plugin.ts` |
| 适配器与发送 | `packages/core/src/adapter.ts` |
| 消息调度 | `packages/core/src/built/dispatcher.ts` |
| Agent 编排 | `packages/agent/src/orchestrator/` |
| 安全策略 | `packages/agent/src/security/` |
| AI 引擎 | `packages/ai/src/agent/` |
| 队列运行时 | `packages/queue-runtime/src/runtime.ts` |
