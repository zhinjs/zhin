# 对齐 Missions Multi-Agent Harness（missions / MissionRunner）

在 Agent Mesh 硬编排（[`OrchestrationService`](../../packages/im/agent/src/orchestrator/orchestration-service.ts) + MCP `agent.delegate_task`）已落地之后，本 ADR 记录 **Missions** 式 Multi-Agent Harness 的借鉴边界与实现决策。

Missions 核心论点：软件工程瓶颈已从「模型会不会写」转为「人类来不及审」；解法不是更大 prompt，而是 **结构化协作 + 验证纪律 + 人类仅守里程碑**。

Grill 定稿摘要见本文「已定稿决策」章节（#1–#8）。

## 背景

### Agent Mesh v1 已覆盖 vs 本 ADR 范围

| 层 | v1 现状 | 本 ADR |
|----|---------|--------|
| 硬编排 DAG | 手动 DAG | **`missions`** 五阶段 + Spec gate |
| 任务门禁 | `AgentDispatcher.canExecute` 依赖链 | + Writer mutex + Spec dry-run gate |
| 角色权限 | 7 角色；reviewer 可读源码 | + **validator** 硬隔离（禁读实现） |
| 状态共享 | task `context_json` 分散 | **Mission State**（run 级 JSON + version） |
| 推进方式 | 主 Agent 手动 `spawn_task` | **MissionRunner** 自动推进 |
| 质量闭环 | reviewer LLM 读代码 | **Validation Spec**（可执行断言包） |
| 跨机委托 | MCP `acceptance_criteria` 字符串 | 结构化 spec 路径 + manifest（仍不传本地路径） |

### Missions 五模式 vs Zhin 映射

| Missions 模式 | Zhin 对应 | 本 ADR 决策 |
|---------------|-----------|-------------|
| Delegation | Orchestrator + `spawn_task` / MCP delegate | 保留；MissionRunner 接管本地 spawn |
| Creator-Verifier | validator + `run_validation_spec` | **D2 + D3** |
| Broadcast | `mission_state_json` + `orchestration_status` | **D1** |
| Negotiation | `mission-negotiation` 阶段闸门 | **D5** |
| Direct Communication | Agent 互聊 | **不采用**（Agent 数量可控，走 Mission State） |

### 不在本 ADR 范围

- 替换现有 `spawn_task` / `SubagentManager`（missions 在其上叠加）
- 去掉 exec/file Owner 确认或 harness 安全策略（见 [Agent Harness Engineering](../advanced/agent-harness-engineering.md)）
- Validator worktree 物理隔离（后续）；`missions` 已支持 `executor: remote:<id>`
- IM 出站链 — 见 ADR 0004
- pi coding-agent 会话树 / compaction — 见 ADR 0010

## 决策

### D1. Mission State（Broadcast 共享硬盘）

扩展 [`orchestration-db-models.ts`](../../packages/im/ai/src/memory/orchestration-db-models.ts)：

- `orchestration_runs.mission_state_json` + `state_version`
- `orchestration_tasks.is_writer` + `phase`

**Mission State schema（最小）：**

- `phase`: plan | spec | develop | validate | negotiate | done
- `validation_spec_paths[]`, `assertion_count`, `last_validation`
- `decision_log[]`, `retry_budget`, `writer_task_id`

**写入 API：** `OrchestrationRepository.patchMissionState`；工具 `orchestration_patch_state`（按 phase 校验写权限）。

### D2. Validation Spec 前置（可执行断言包）

**流程颠覆：** 先 Plan + Spec，再 Develop；Spec 独立于实现。

**仓库约定：**

```
.zhin/missions/<runId>/
  plan.md
  spec.test.ts      # vitest 行为断言
  manifest.json     # assertion id + 描述
```

**Spec gate：** Develop 任务 `canExecute` 要求 `validation_spec_paths` 非空且 spec dry-run 已通过（Planner 阶段或 MissionRunner 校验）。

**不采用：** 纯自然语言 `acceptance_criteria` 作为唯一验收（可保留为 manifest 人类可读摘要）。

### D3. Validator 硬隔离（Creator-Verifier）

新增 `AgentRole: validator`：

- **allowed:** `run_validation_spec`（专用工具，内部固定 vitest 命令模板）
- **blocked:** `read_file`, `grep`, `glob`, `list_dir`, `write_file`, `edit_file`, `web_*`, 通用 `bash`

Validator **不得**阅读实现源码；仅根据 spec 运行结果 pass/fail。

`reviewer` 角色保留于 Agent 角色表；Mission 验收使用 **validator**（禁读实现）。

### D4. Run 级单 Writer mutex

同一 `orchestration_run` 内，`is_writer=true` 的任务同时最多一个 `running`。

只读角色（planner / researcher / validator / negotiate）可并行；写角色（subtask / executor / worker 且 is_writer）互斥。

**理由（Missions）：** 并行 Writer 协调开销吃光并行红利。

### D5. Negotiation（阶段刹车）

阶段边界由 Planner 二次评估（读 Mission State + decision_log，**不读 src/**）：

| 边界 | 检查 | 失败动作 |
|------|------|----------|
| Plan+Spec 完成 | assertion_count > 0；spec dry-run 绿 | replan Spec |
| Validate 失败 | retry_budget.validate 未耗尽 | retry Dev |
| Validate 失败 | 预算耗尽 | replan Spec 或 fail run |

决策写入 `decision_log`；通过 `retry_task` / `skip_task` / phase 更新执行。

### D6. MissionRunner（全自动推进）

硬编排与 MissionRunner **始终开启**（无配置开关）：

- `AgentDispatcher.recordResult` 后，MissionRunner 自动 `autoSpawnTask` 下一可执行任务
- `missions` run **禁止**主 Agent 手动 `spawn_task`（避免双轨推进）

人类仅在里程碑收到通知（见 D7），不阻塞自动循环。

### D7. 人类里程碑闸门

| 节点 | 行为 |
|------|------|
| Run 启动 | 可选 `awaitOwnerAtMilestone` 才启动 MissionRunner |
| Validate 全绿 | 通知「Mission 可合并」 |
| Negotiation fail run / 超 retry | 通知 Owner |
| exec/file 安全 | 现有 Owner 确认 + harness 策略（不变） |

配置：`ai.orchestration.milestones.notify: im | console | both`

### D8. 模板 `missions`

[`OrchestrationService.startRun`](../../packages/im/agent/src/orchestrator/orchestration-service.ts) 默认模板，预置 DAG：

Plan → WriteSpec → Develop(is_writer) → Validate(validator) → Negotiate(条件)

`orchestration_start` **仅**创建 `missions` run。

**破坏更新（2026-06-09）**：删除 `plan-dev-review`、`missions-v1`/`missions-v2` 分叉与 `ai.orchestration.*` 配置项；硬编排始终内置。

## 后果

### 正面

- 验收与实现解耦，避免「测试迁就实现」
- Validator 客观性可审计（工具 denylist + spec 产物）
- Mission State 形成 Broadcast 飞轮，后续 Agent 可续跑
- 人类注意力收敛到里程碑，吞吐量模型从「审每个 PR」转为「审每个 Mission」

### 负面 / 风险

- **DB schema 变更**：新列需 migration；旧 run 兼容（nullable default）
- **MissionRunner 与主 Agent 竞态**：须 hard gate 禁止手动 spawn
- **Spec 质量依赖 Planner**：错误 Spec 导致空转；Negotiation + retry_budget 缓解
- **MVP 范围**：全自动闭环 + Negotiation 单 PR 体积大；按 ADR 实施顺序分 commit

## 完成定义

- [x] ADR 0011 合入；[`docs/adr/README.md`](./README.md) 索引更新
- [x] `missions` 模板 + Mission State patch API
- [x] validator 角色 + `run_validation_spec` + Writer mutex + Spec gate
- [x] MissionRunner 自动推进 + Negotiation decision_log
- [x] 自动 spec dry-run + manifest + phase ACL + 里程碑通知
- [x] 单测：`missions-*` + 扩展 `orchestration-e2e`
- [x] [`docs/advanced/agent-mesh.md`](../advanced/agent-mesh.md) 同步
- [x] [`examples/full-bot`](../../examples/full-bot/README.md) L4 契约
- [ ] Changeset：`@zhin.js/agent` / `@zhin.js/ai` minor

## 与现有 ADR 的关系

| ADR | 关系 |
|-----|------|
| 0010 | **并列** Harness 层；0010 管 compaction/会话树，本 ADR 管多 Agent 编排纪律 |
| 0009 | MissionRunner 仍走 `agentLoop` / `spawn_task` 子路径 |
| 0003 | validator 工具集走 centralized tool selection |
| 0004 | IM 出站 / 里程碑通知不变发送链 |
| 0007 | `modelHarness.maxIterations` 与 Mission retry_budget 独立 |
| 0008 | Assistant Runtime Job 可触发 missions run（后续集成，非阻塞 MVP） |

## 已定稿决策（Grill 2026-06-09，#1–#8）

| # | 问题 | 决定 |
|---|------|------|
| 1 | 边界 | **B** — 演进 OrchestrationService / Agent Mesh（硬编排内置） |
| 2 | 人类介入 | **A** — 里程碑闸门（Run 启停、合并、安全/预算） |
| 3 | Validation Spec | **A** — 可执行断言包（vitest / check:*） |
| 4 | Validator 隔离 | **A** — 角色硬隔离（禁读源码工具） |
| 5 | 单 Writer | **A** — Run 级 Writer mutex |
| 6 | Mission State | **A** — 扩展 orchestration_runs SQLite |
| 7 | Negotiation | **A** — 阶段闸门 + Orchestrator 重评估 |
| 8 | MVP | **C** — 全自动闭环 + Mission State + 里程碑人类通知 |

## 状态

- **提议日期**：2026-06-09
- **Grill 定稿**：2026-06-09（#1–#8）
- **状态**：已接受，**已实现**
