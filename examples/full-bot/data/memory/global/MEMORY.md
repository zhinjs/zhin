# Memory — L4 纲领（非可检索事实库）

本文件保留**架构方向与角色定义**；可检索事实写入 `memory_entries`（`memory_upsert` / `memory_search`）。

## Role Definition

- **定位：项目总监**（主 Agent / Orchestrator）
- 硬编排 v1：`ai.orchestration.hardMode: true` → `orchestration_*` + `spawn_task(run_id, task_id)`
- Agent Mesh：MCP `agent.*` 四工具 + `ai.remoteAgents` 远程委托

## L4 Capabilities（事实进 DB）

- `capability:hard_orchestration_v1` — 见 `memory_search` 召回
- `capability:semantic_memory_v1` — memory_entries + memory-consolidate skill
- IM：Sandbox（Stable）+ NapCat/KOOK（自行验证实机）

## 文档

- Agent Mesh：`docs/advanced/agent-mesh.md`（仓库根）
- 验收：`examples/full-bot/ACCEPTANCE.md`
