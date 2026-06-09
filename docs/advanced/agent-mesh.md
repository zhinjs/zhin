# Agent Mesh 硬编排

基于项目总监模型：本地 **硬编排 DAG** + **MCP Agent Mesh** 跨实例委托。

Missions Harness 见 [ADR 0011](../adr/0011-missions-harness-alignment.md)。

## 本地硬编排（始终开启）

主 Agent 自带总监工具，**无配置开关**：

| 工具 | 说明 |
|------|------|
| `orchestration_start` | 创建 Mission run（`missions` 五阶段 DAG） |
| `orchestration_add_task` | 自定义 DAG 节点（`depends_on`、`executor: remote:<id>`） |
| `orchestration_status` | 查询 run + 任务状态 + Mission State 摘要 |
| `orchestration_patch_state` | 更新 Mission State（按 phase ACL） |
| `orchestration_complete` | 关闭 run |
| `orchestration_retry_task` | 重置 failed 任务 |
| `orchestration_skip_task` | 跳过任务并解锁下游 |

`spawn_task` 须传 `run_id` + `task_id`；`missions` run 由 **MissionRunner** 自动推进，禁止手动 `spawn_task`。

### missions 模板

| 阶段 | 角色 | 说明 |
|------|------|------|
| Plan / WriteSpec | planner | 产出 Plan + Validation Spec（manifest + spec.test.ts） |
| Develop | subtask（单 Writer） | Spec gate 通过后执行 |
| Validate | validator | 仅 `run_validation_spec`，禁读源码；可 `remote:<id>` |
| Negotiate | planner | Validate 失败时重评估 |

MissionRunner 自动推进并跑 spec dry-run。远程 Validate：启动时传 `remote_validator: <agentId>`（对应 `ai.remoteAgents[].id`）。

状态持久化在 Agent SQLite：`orchestration_runs`（含 `mission_state_json`）、`orchestration_tasks`（含 `is_writer`、`phase`）。

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
- Console 编排视图与 `orchestration_status` 同源

## L4 验收（full-bot）

1. 启动 full-bot，`pnpm check:l4`
2. 确认 `ai.remoteAgents[].id: local` loopback
3. 沙盒：`orchestration_start`（无需 template）→ MissionRunner 自动推进 Plan
