# ADR 0026：RosterRound 轮流发言编排 Harness

## 状态

**Superseded** — 已收敛至 [ADR 0024](./0024-five-agent-aop-pipeline.md) 的 `PipelineState.pendingDelegateTarget` + `processCollaborationPostTurn` post-turn harness（2026-06）。`round_state` 列保留作 DB 迁移兼容，运行时不再读写。

## 背景

- 五 Agent 同群协作时，人类常要求**按 roster 顺序轮流发言**（自我介绍、进展汇报、评审表态、分工说明等）。若把「@ 下一角色 / handoff」写进 prompt，模型会越权代 Planner 催下一棒（Evaluator/Reviewer 乱 @ Researcher），与 peer @ 门控、Pipeline `allowedNextStages` 打架。
- [ADR 0025](./0025-adapter-ai-outbound-json.md) 解决了出站 JSON → 真实 at segment，但**不能**单独约束「谁该在何时发言」——这是编排层职责。

## 决策

### D1. RosterRound 与 Pipeline 正交

| 机制 | 职责 |
|------|------|
| `PipelineState` | 任务阶段机（researcher → evaluator → …） |
| `RosterRoundState` | **轮流发言** harness：按 roster 顺序依次 @ 下一位 |

`RosterRoundState` 持久化在 `collaboration_cells.round_state`：

```ts
interface RosterRoundState {
  status: 'active' | 'completed' | 'cancelled';
  order: string[];      // endpointId[]
  cursor: number;       // 下一应发言者 index
  spoken: string[];     // 已发言（幂等）
  triggerMessageId?: string;
  updatedAt: number;
}
```

顺序 SSOT：`planner → researcher → evaluator → executor → reviewer`（缺角色跳过）。

**RosterRound 只管「谁轮到说」**；每位 Agent 说什么（自我介绍、汇报、评审意见等）由模型根据人类原始请求与上下文自由生成。

### D2. 禁止 prompt 编排剧本

- **不得**在 `FIVE_AGENT_PROMPTS`、`collaboration-context`、`.agent.md` 等注入「@ 下一角色 / 轮流 handoff / 催下一位发言」类**编排**指令。
- 启动仅用确定性关键词：`detectRosterRoundTrigger`（依次 / 轮流 / 按顺序 / 点名 / round robin 等）；**单纯 `@` 某人不触发**（与 `detectInboundHandoffIntent` 分离）。
- Harness 固定 ping 文案 `ROSTER_ROUND_PING_TEXT`（`请发言。`），**不进 prompt**。

### D3. 集成点

1. **入站门控** — `evaluateCellAtOwnership`：`round_state.active` 时仅 `expectedSpeaker` 且含真实 @ 可响应；其他成员 → `roster_round_not_expected`。
2. **Post-turn** — `inbound-turn-pipeline` AI 出站成功后：`startRosterRound` / `advanceRosterRound` + `sendGroupPeerMention`。
3. **工具 ACL** — `group_delegate` 在 `round_state.active` 时一律拒绝（`roster_round_active_delegate_forbidden`）；仅 harness 可发 @。

### D4. 与 ADR 0025 关系

- **保留**通用 JSON 出站 hint + 假 `@` 兜底 parser（格式契约）。
- **移除** `forceJsonOnly: detectInboundHandoffIntent(...)` 类编排提示注入。

## 实机验收（ICQQ 五 Agent 群 `373460458`）

**场景 A — 自我介绍（典型用例）**

1. 人类 `@8596238 叫大家依次自我介绍`
2. `send` 链依次出现真实 `{at}` → researcher → evaluator → executor → reviewer
3. Evaluator/Reviewer **不再**越权 `send @researcher`
4. Researcher **不重复**发言（`spoken` 幂等）

**场景 B — 非 intro（同样走 RosterRound）**

1. 人类 `@8596238 请大家依次汇报本周进展`
2. 同样按 roster 顺序 harness @；各 Agent 回复内容为汇报而非自我介绍

## 后果

- 新增 DB 列 `round_state`（SQLite ALTER，与 `pipeline_state` 同路径）。
- RosterRound 与 Pipeline 可并存；人类新消息默认不打断 active round（二期可加 `cancelRosterRound`）。

## 相关

- [ADR 0023 — GroupCell 多 Endpoint 协作](./0023-group-cell-multi-endpoint-agents.md)
- [ADR 0024 — Five-Agent Pipeline](./0024-five-agent-aop-pipeline.md)
- [ADR 0025 — Adapter AI Outbound JSON](./0025-adapter-ai-outbound-json.md)
