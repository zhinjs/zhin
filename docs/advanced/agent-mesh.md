---
sidebar: false
---

# Agent Mesh

基于 [OrchestrationKernel](../adr/0027-agent-run-orchestration-kernel.md)：本地 Run/Task 状态机 + **MCP Agent Mesh** 跨实例委托。

历史 Missions Harness 见 [ADR 0011](../adr/0011-missions-harness-alignment.md)，新实现以 kernel run/task/event 为准。

## 本地编排（始终开启）

主 Agent 自带编排工具，**无配置开关**：

| 工具 | 说明 |
|------|------|
| `orchestration_start` | 创建 run |
| `orchestration_add_task` | 自定义 DAG 节点（`depends_on`、`executor: remote:<id>`） |
| `orchestration_status` | 查询 run + task 状态 |
| `orchestration_patch_state` | Legacy 兼容；新流程优先写 task progress/result |
| `orchestration_complete` | 关闭 run |
| `orchestration_retry_task` | 重置 failed 任务 |
| `orchestration_skip_task` | 跳过任务并解锁下游 |

`spawn_task` 默认会创建 kernel task 并返回 `#taskId`；传 `run_id` + `task_id` 时执行已有任务。

### Run / Task

Kernel 固定状态：

- `RunStatus = open | running | waiting | completed | failed | cancelled`
- `TaskStatus = pending | assigned | running | waiting_result | completed | failed | cancelled`

状态持久化在 Agent SQLite：`orchestration_runs`、`orchestration_tasks`、`orchestration_events`。

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

本地 `orchestration_add_task` 设 `executor: remote:ops-bot` 时，任务进入 `remote_mesh` executor；`RemoteTaskPoller` 轮询 `query_status` / `get_result` 并回写 kernel task。

### 跨机上下文边界

`delegate_task` 仅传结构化 payload（title、description、acceptance_criteria、artifacts），不传本地路径或 session tree。

## REST 可观测

- `GET /api/agent/orchestration/runs?sessionKey=`
- Console 编排视图与 `orchestration_status` 同源

## L4 验收（full-bot）

1. 启动 full-bot，`pnpm check:l4`
2. 确认 `ai.remoteAgents[].id: local` loopback
3. 沙盒：`orchestration_start` → `orchestration_add_task executor=remote:local` → `orchestration_status`
