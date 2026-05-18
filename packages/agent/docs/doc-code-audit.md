# Agent Runtime：文档 ↔ 代码对照表

| 文档路径 | 文档声称 | 代码实际 | 严重度 | 修订 |
|----------|----------|----------|--------|------|
| `CONTEXT.md` 关系 | ZhinAgent 经 Orchestrator 发现 MCP 资源 | `ensureConnected` + `getAllMcpTools` 在 AI 回合前/工具收集时执行 | — | 已对齐 |
| `architecture-overview.md` | `McpClientManager` 与编排层配合 | `McpRegistry` 委托 `McpClientManager` | — | 已对齐 |
| `README.md` 全局上下文 | 仅 `ctx.ai` | 另有 `ctx.agent: AgentOrchestrator` | 中 | 已补充双 Context |
| `README.md` / 根文档 | Prompt 10 段 | `prompt.ts` §1–§11 | 中 | 已统一为 11 段 |
| `README.md` 项目结构 | `init/index.ts` | 入口为 `src/init.ts` | 低 | 已修正结构图 |

**区分命名**：`packages/agent/src/mcp-client/bridge.ts` 为 MCP 工具桥接；`plugins/services/mcp` 为 MCP **Server**（向外暴露 Zhin 工具），与 MCP **Client** 不同。
