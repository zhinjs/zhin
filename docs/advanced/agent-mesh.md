---
sidebar: false
---

# Agent Mesh

基于 [OrchestrationKernel](../adr/0027-agent-run-orchestration-kernel.md)：本地 Run/Task 状态机 + **A2A** 跨实例委派（[ADR 0035](../adr/0035-a2a-agent-mesh.md)）。

历史 MCP `agent.*` 四工具已移除；MCP 插件（`@zhin.js/mcp`）仅暴露 ToolFeature 工具。

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

## 层内协作（同实例，ADR 0036）

CollaborationScene 内跨 endpoint 默认 **`internal_room`**（不经 IM 触发 peer）；可选 **`project_to_im`** 链式 **`im_projection`** 做群聊可见投影。

| Executor | 场景 |
|----------|------|
| `internal_room` | 同实例 peer 直派（TurnPlan / `orchestration_add_task`） |
| `im_projection` | 仅 IM @ 投影（legacy `scene_mention` 读时 alias） |
| `remote_mesh` | 跨实例 A2A（见下） |

Handback：`internal_room` 仅 kernel 完成；`im_projection` 仍可通过 IM `#taskId` 完成。

## A2A Agent Mesh

启用 Host 插件 `@zhin.js/a2a` 后，每个 `ai.agents[]` 自动暴露独立 [Agent Card](https://a2a-protocol.org/v1.0.0/specification)：

| 路由 | 说明 |
|------|------|
| `GET /a2a/{agentName}/.well-known/agent-card.json` | Agent Card |
| `POST /a2a/{agentName}/jsonrpc` | JSON-RPC（含 SSE 流） |
| `* /a2a/{agentName}/rest/*` | HTTP+JSON REST |

### 鉴权

- 入站/出站均使用 `Authorization: Bearer <http.token>`
- Agent Card 声明 `securitySchemes.bearer`

### 远程 Agent 发现

```yaml
plugins:
  - "@zhin.js/a2a"

ai:
  remoteAgents:
    - id: ops-bot
      name: 运维总监
      cardUrl: https://ops.example.com/a2a/pm/.well-known/agent-card.json
      token: ${REMOTE_OPS_TOKEN}
      roles: [planner, executor]
      description: 负责部署与运维
```

- 启动时 `GET cardUrl` 拉取并缓存 Agent Card
- `orchestration_add_task` 设 `executor: remote:ops-bot` → `remote_mesh` executor
- 出站优先 `SendStreamingMessage`（SSE）；不支持 streaming 时 fallback `Get Task` 轮询
- `task.role` 映射远端 `skills[].id`

### 跨机上下文边界

A2A Message 仅传结构化文本/数据 parts（title、description、acceptance_criteria、artifacts），不传本地路径或 session tree。

## REST 可观测

- `GET /api/agent/orchestration/runs?sessionKey=`
- Console 编排视图与 `orchestration_status` 同源

## L4 验收（full-bot）

1. 启动 full-bot，`pnpm check:l4`
2. 确认 `ai.remoteAgents[].id: local` loopback `cardUrl` 指向本机 `/a2a/zhin/...`
3. 沙盒：`orchestration_start` → `orchestration_add_task executor=remote:local` → `orchestration_status`
