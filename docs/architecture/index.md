# 架构文档索引

本目录是 Zhin.js **架构与契约** 的入口。修改 IM 消息链或出站路径时，先读此处再改代码。

## IM 主栈（Stable）

默认开发与对外承诺范围以 [examples/minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 为准。

| 文档 | 说明 |
|------|------|
| [架构概览](/architecture-overview) | 分层（basic → kernel → ai → core → agent → zhin）、消息流程图 |
| [ADR 0009 — agentLoop 统一栈](/adr/0009-pi-aligned-ai-agent-core) | `im_transcripts` / `agent_messages`、agentLoop 迁移 |
| [AI 模块](/advanced/ai) | `agents` 配置、ModelRegistry + `getModel`、工具与记忆 |
| [packages 子包 README](https://github.com/zhinjs/zhin/tree/main/packages/README.md) | 各 npm 包 README 索引 |
| [仓库结构](/contributing/repo-structure) | pnpm workspace、`src→lib` / `client→dist` |
| [Harness 工程](/contributing/harness-engineering) | 发送链路、层级依赖、CI 检查 |
| [Agent 上下文块](/architecture/agent-context-blocks) | 系统提示词分段与贡献者约定 |
| [Agent 提示词贡献者](/architecture/agent-prompt-contributors) | 平台专属 `AgentPromptContributor` |
| [HTTP 路由编写](/architecture/fetch-router-authoring) | Koa `Router` / `registerFetchRoute` 兼容 API |

根目录 [AGENTS.md](https://github.com/zhinjs/zhin/blob/main/AGENTS.md) 为 AI 编码代理的最小入口。

## 代码锚点

| 用途 | 路径 |
|------|------|
| 插件 / 命令 / 中间件 | `packages/im/core/src/plugin.ts` |
| 适配器与发送 | `packages/im/core/src/adapter.ts` |
| 消息调度 | `packages/im/core/src/built/dispatcher.ts` |
| 出站字段规范化（cron 等） | `packages/im/core/src/built/queue-im-field-contract.ts` |
| Agent 编排 | `packages/im/agent/src/orchestrator/` |
| 安全策略 | `packages/im/agent/src/security/` |
| LLM 统一栈 | `packages/im/ai/src/llm/`（`agentLoop`、`api-registry`） |
| IM 落库 | `packages/im/zhin/src/setup/register-chat-message-store.ts` |
| Host Router | `packages/host/router/src/` |
| Host API | `packages/host/api/src/` |

## 用户向补充

若你刚接触 Agent / MCP，建议先读 [Agent 概念入门](/advanced/agent-concepts) 与 [MCP 集成](/advanced/mcp)，再回来查阅本目录下的契约文档。
