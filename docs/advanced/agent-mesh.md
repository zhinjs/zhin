# Agent Mesh 硬编排 v1

基于项目总监模型：本地 **硬编排 DAG** + **MCP Agent Mesh** 跨实例委托。

## 本地硬编排

启用 `ai.orchestration.hardMode: true` 后，主 Agent 获得总监工具：

| 工具 | 说明 |
|------|------|
| `orchestration_start` | 创建 run；可选 `template: plan-dev-review` |
| `orchestration_add_task` | 添加 DAG 节点（`depends_on`、`executor: remote:<id>`） |
| `orchestration_status` | 查询 run + 任务状态 |
| `orchestration_complete` | 关闭 run |
| `orchestration_retry_task` | 重置 failed 任务 |
| `orchestration_skip_task` | 跳过任务并解锁下游 |

`spawn_task` 在硬编排模式下须传 `run_id` + `task_id`；执行前经 `AgentDispatcher.canExecute` 门禁。

状态持久化在 Agent SQLite：`orchestration_runs`、`orchestration_tasks`。

## MCP Agent Mesh

现有 `/mcp` 端点追加四个标准工具（由 `@zhin.js/agent` 注册）：

- `agent.delegate_task`
- `agent.query_status`
- `agent.get_result`
- `agent.cancel_task`

### 鉴权

- `agent.*` 工具**始终**要求 `Authorization: Bearer <token>`
- Token 取自 `mcp.token` 或 `http.token`
- 非 `agent.*` 工具在开发环境 localhost 可配置宽松（`mcp.allowUnauthenticatedLocalhost`）

### 远程 Agent 注册表

```yaml
ai:
  remoteAgents:
    - id: ops-bot
      name: 运维总监
      url: http://192.168.1.10:8787/mcp
      token: ${REMOTE_OPS_TOKEN}
      roles: [planner, executor]
      description: 负责部署与运维
```

本地 `orchestration_add_task` 设 `executor: remote:ops-bot` 时，通过 MCP 委托；`RemoteTaskPoller` 轮询 `query_status` / `get_result`。

### 跨机上下文边界

`delegate_task` 仅传结构化 payload（title、description、acceptance_criteria、artifacts），不传本地路径或 session tree。

## REST 可观测

- `GET /api/agent/orchestration/runs?sessionKey=`
- `GET /api/agent/orchestration/runs/:runId`

与 `orchestration_status` 共用同一数据源。

## full-bot L4 验收

[`examples/full-bot`](../../examples/full-bot/) 为 L4 参考实例（非 Stable / 非 test-bot 厨房水槽）：

1. `cd examples/full-bot && cp .env.example .env && pnpm dev`
2. 确认 `ai.orchestration.hardMode: true` 与 `ai.remoteAgents[].id: local` loopback
3. Sandbox 触发 `plan-dev-review` 编排，验证 dev 在 planner 完成前被门禁拒绝
4. `curl` 无 Bearer 调 `/mcp` 的 `agent.delegate_task` → 401
5. 自动化：`pnpm check:l4`（仓库根）

手工步骤见 [full-bot ACCEPTANCE.md](../../examples/full-bot/ACCEPTANCE.md)。

## 参考

- [MCP 集成](./mcp.md)
- [Console 需求](../console/requirements.md)
- [full-bot README](../../examples/full-bot/README.md)
