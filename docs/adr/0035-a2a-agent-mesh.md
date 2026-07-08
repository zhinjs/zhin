# ADR 0035: A2A Agent Mesh（替换 MCP Mesh v1）

## Status

Accepted.

## Context

Zhin Agent Mesh v1 使用自研 MCP 四工具（`agent.delegate_task` 等）实现跨实例委派。该方案仅 Zhin `/mcp` 客户端可互操作，无 Agent Card 发现，状态同步依赖 15s 轮询。

[A2A Protocol v1.0](https://a2a-protocol.org/v1.0.0/specification) 是 Linux Foundation 主推的 Agent↔Agent 标准，与 MCP（Agent↔Tool）互补。官方 JavaScript SDK：`@a2a-js/sdk@next`（v1.0 beta）。

Grilling 共识（2026-07）：用户接受破坏性更新，要求规范对齐。

## Decision

### D1 — 双域协作模型

| 域 | 场景 | 传输 |
| --- | --- | --- |
| 层内 | 同实例 IM `@mention` / CollaborationScene | `scene_mention` + OrchestrationKernel |
| 层间 | 跨实例 / 跨框架委派 | **A2A v1.0**（JSON-RPC + REST + SSE） |

OrchestrationKernel 仍是 Zhin 内部 Run/Task SSOT；A2A 是 Host 层对外协议投影。

### D2 — 移除 MCP Agent Mesh v1

- 删除 `agent.delegate_task` / `query_status` / `get_result` / `cancel_task`
- `@zhin.js/mcp` 仅暴露 ToolFeature 工具
- `remote_mesh` executor 改用 A2A Client

### D3 — 可选 Host 插件 `@zhin.js/a2a`

- 插件加载即自动为全部 `ai.agents[]` 暴露 A2A Server
- 路由：`/a2a/{agentName}/jsonrpc`、`/a2a/{agentName}/rest`、`/a2a/{agentName}/.well-known/agent-card.json`
- 每 agent 独立 Agent Card + `DefaultRequestHandler` + `ZhinA2AExecutor`
- 入站 Task 绑定对应 `ai.agents.{name}` 的 ZhinAgent binding
- 鉴权：`Authorization: Bearer <http.token>`

### D4 — 发现与出站

配置破坏性变更：

```yaml
ai:
  remoteAgents:
    - id: ops
      cardUrl: https://host/a2a/pm/.well-known/agent-card.json
      token: ${TOKEN}   # 可选
```

- 启动时 `GET cardUrl` 缓存 Agent Card
- `remote_mesh` 出站：`SendStreamingMessage`（SSE 为主）+ `Get Task` 轮询 fallback
- `task.role` → 远端 `skills[].id`

### D5 — SDK 与传输

- `@a2a-js/sdk@1.0.0-beta.0`（pin beta）
- Server：`JsonRpcTransportHandler` + 自研 Koa/HTTP 适配（不引入 Express）
- Client：`ClientFactory` + Bearer `CallInterceptor`

## Consequences

- `ai.remoteAgents[].url`（指向 `/mcp`）**已删除**，改用 `cardUrl`
- full-bot L4 loopback 指向本机 A2A Card URL
- ADR 0027 executor 表：`remote_mesh` 描述改为 A2A（非 MCP/HTTP）

## Related

- [ADR 0027](./0027-agent-run-orchestration-kernel.md)
- [Agent Mesh 文档](../advanced/agent-mesh.md)
- [A2A Protocol v1.0](https://a2a-protocol.org/v1.0.0/specification)
