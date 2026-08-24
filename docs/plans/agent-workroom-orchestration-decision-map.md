---
sidebar: false
---

# Agent Workroom 与多 Agent 编排决策地图

目标：把 Zhin 的多人 Session、动态多 Agent 工作流、可观察 Workroom、可靠调度与分层记忆收敛成一个 Kernel-owned 产品模型。

生产化欠账单独记录在 [`agent-workroom-production-ledger.md`](./agent-workroom-production-ledger.md)；原型结论不等于已经上线。

## 已确认边界

- `Workroom = Project`；它隔离 Project State Memory、Artifact、Run、队列、预算与 policy。
- 通用 Workroom Kernel 不感知具体行业；每个 Project 通过可组合 Workroom Profile 获得领域角色、工作流、能力、记忆 schema 与风险/验收策略。
- Workroom Profile 组合 domain/competency/integration/policy 四类 Capability Pack；Tool/Skill 可跨 Pack 复用，Assignment 只装载 Task 所需交集。
- private/group/channel 与 `chat/workroom/sponsor_room` 正交；每个 canonical conversation address 同时最多绑定一种 Interaction Space，未绑定默认 `chat`，切换必须显式迁移。
- Sponsor Room 聚合跨项目看板与控制，但写操作必须明确指向 Project。
- Orchestrator 为每个 Run 动态生成版本化 Workflow Plan（Task DAG）。
- Agent Definition 是稳定角色；Agent Assignment 是绑定 Task 的执行实例。
- 每个 Assignment 只获得按 Profile/Role/Task/Policy 取交集的版本化 Tool/Skill snapshot；缺少能力必须提交 Capability Request，不能自行扩权。
- Workroom 人类消息只进入 Orchestrator；`@Agent`/回复转为 Kernel TaskInputEvent，角色由不可伪造的 Execution Envelope 与能力集约束。
- Kernel 是 Run/Task/Plan 状态唯一权威；Agent discussion 与 IM 消息不是协作协议。
- Workroom 展示关键进度、交接、阻塞、结论和审批；完整 trace 留给 Console。
- Sponsor/授权角色控制目标、优先级、审批和取消；普通参与者默认只能讨论。
- 可变 Task 默认使用隔离 workspace；发布通过 Integration Task。
- `execution_completed` 不等于 `accepted`；Project State 只消费 accepted 结果。
- 本地 Executor 先达到可靠交付；A2A 后续复用同一契约，以 GitHub 等版本化 workspace reference 协作。

## #1: 冻结 Orchestration Kernel 状态机

Blocked by: none
Type: Prototype

### Question

现有 Run/Task/Executor/Dispatcher 如何迁移为支持 Plan revision、approval、pause/preempt/resume/cancel、lease recovery 与 acceptance 的唯一状态机，同时删除重复权威？

### Answer

采用 breaking replacement，不在现有 `OrchestrationKernel + AgentDispatcher + TaskQueue` 三套可变状态上继续打补丁。

- Kernel Journal 是唯一写入权威；Run/Task/Assignment/Blocker 表和 Dispatcher 只能是可丢弃、可 replay 的 projection。Repository 写接口收敛为按 `expectedSequence` 原子追加事件，不再公开 `updateTaskStatus` 一类任意跳转。
- Task 与 Assignment 分离。Task 表达工作与验收生命周期：`ready → blocked/executing/paused → awaiting_acceptance → accepted`，以及 `failed/cancelled`；Assignment 表达一次带 role、owner、lease、attempt、checkpoint 和 execution envelope 的执行租约。
- `execution_completed` 只结束 Assignment，不结束 Task；只有 acceptance policy 产生的 `task.accepted` 才能进入 Project State、推进依赖或让 Run 成功。
- pause/preempt/cancel 都是两阶段控制。请求带 control deadline；执行者可提交 checkpoint/ack，逾期则 Kernel 将 Assignment 结算为 `lost/cancelled + outcome_unknown`，释放调度权，不能无限等待某个 Agent。
- 每个外部等待都建模为 Blocker，必须携带 owner、reason、deadline、allowed actions；到期后的升级/重规划策略由 Scheduler 决定，但 `resolve/replan/cancel` 始终可达。
- lease heartbeat 与过期也是 Journal event。过期 Assignment 进入 `lost`；Task 在修订版内按 retry policy 回到 `ready` 或 `failed`。Task 返工创建新 revision，并重置该 revision 的 attempt budget，不能复用旧 Assignment identity。
- Run 状态由 Journal projection 派生，禁止 Kernel、Dispatcher、Queue 分别写状态。#2 进一步冻结 close rule：required Task 失败/取消先进入 `needs_replan`，只有显式的 policy/Sponsor 结算才把 Run 置为 failed；这避免一次可替换执行失败过早关闭整个 Run。
- 角色不是消息里的提示词，而是 Assignment/Execution Envelope 的不可伪造字段。Executor 只能提交 progress/checkpoint/report，不能自行 acceptance 或修改 Task/Run 状态。

原型位于 `packages/im/agent/prototypes/orchestration-kernel-state-machine/`，已验证 accepted happy path、返工 revision、忽略 preempt、lease 丢失、忽略 cancel、人工阻塞到期后恢复以及 JSON journal replay。生产实现时吸收纯状态机并删除 TUI，不保留第二套兼容状态机。

## #2: 定义 Workflow Plan 与 Scheduler 契约

Blocked by: #1
Type: Prototype

### Question

如何持久化版本化 Task DAG、Plan Revision、Workroom Inbox、确定性 priority/aging、依赖推进和安全点抢占，并让 Orchestrator 只提出计划而不拥有队列真相？

### Answer

采用持久化 Workroom Inbox、不可变 Plan Revision 与无状态确定性 Scheduler，删除旧 `TaskQueue` 的执行函数队列模型。

- 每个授权工作请求先成为 Workroom Inbox item，保存 principal/authority、intent/scope、可信 Sponsor lane、deadline 与来源 event。Orchestrator 只能消费 Inbox 并提交 Plan proposal，不能直接 dispatch、删除请求或自行声明 Sponsor priority。
- Workflow Plan 是 versioned Task DAG。proposal 必须携带 `baseRevision`、provenance、reason 和完整 diff；Kernel 以 CAS 结算为 `applied | approval_required | rejected | stale`。并发新 revision 获胜后，旧 proposal 自动 stale 并允许 rebase，不能留下一个永远无法批准的 gate。
- Task 使用 stable task key 与独立 task revision；依赖指向 logical task key，再由当前 Plan 解析 active revision。运行中 Task 不得被静默替换，必须先 preempt/checkpoint；ready/waiting/failed/paused Task 才能在一个原子 revision 中被 supersede。Plan 应用前必须验证 DAG 无环、引用完整和 gate 可达。
- dependency edge 默认要求上游 `accepted`；只有显式 `settled`/条件分支才允许在 optional 失败或跳过后继续。上游 execution completed 不得放行下游。
- required Task 失败、取消或被阻断时，Run 进入 `needs_replan`，Orchestrator 可提交替代 revision；Run failed 必须由重试/重规划 policy 或 Sponsor 显式结算。Run completed 要求当前 Plan 的 required Task 全部 accepted，optional Task 全部 settled；optional 可 accepted、failed 或 skipped，但 required 不可直接 skip。
- Scheduler 是 `facts + persisted policy snapshot → decisions` 的纯函数。多实例读取同一 sequence 必须产生相同事件，并通过 `append(expectedSequence, events)` 竞争提交；dispatch 使用 event outbox 与 Assignment id 幂等交付，不依赖进程内 timer、Promise waiter 或 queue array。
- 调度顺序固定为：Kernel control/safety → 已持久化的 preemption reservation → 超过 starvation bound 的 Task → Sponsor lane（urgent/high/normal/low）→ deadline → lane 内 rank + aging → enqueue sequence → task key。aging 不改写 Sponsor lane；profile 配置的 starvation bound 可跨 lane 提供有界公平性。
- Orchestrator 只可在可信 Sponsor lane 内调 local rank。跨 lane 必须生成 Approval Gate，包含 owner、reason、deadline 与 `approve/reject/rebase/cancel_run`；过期默认拒绝，不冻结已经 applied 的 Plan。
- 有空闲 capacity 时 Scheduler 自动 dispatch ready Task。无 capacity 时仅对 checkpointable Assignment 发出两阶段 preempt，并为插队 Task 持久化 slot reservation；atomic 外部动作完成安全原子段后再让出。Executor 忽略 checkpoint deadline 时由 #1 Kernel 以 `outcome_unknown` 释放 lease，Scheduler 仍能推进。
- capacity、aging step、starvation bound、preemption deadline 和 comparator version 都进入 Run 的 Scheduler Policy Snapshot；generation/HMR 更新只影响新 snapshot，不能改变旧 Journal 的 replay 结果。

原型位于 `packages/im/agent/prototypes/workflow-scheduler/`，已验证 DAG acceptance 推进、动态子任务、跨 lane 审批/拒绝/过期、stale proposal、required/optional close rule、合作与超时抢占、starvation reservation 及 JSON replay。

## #3: 定义 Context View 与证据化交接

Blocked by: #1
Type: Prototype

### Question

如何从 Workroom facts 为 Orchestrator、Executor、Reviewer 构造不同 Context View，并以 role-bound Execution Envelope、TaskInputEvent、Task Report、Artifact、authority/intent/scope 和 Plan Revision 防止共享群聊污染所有 Agent？

### Answer

采用「immutable Workroom Facts → role-specific Context View」投影，不再让 Workroom Agent 共享一个 Session messages 数组，也不使用单一 message weight。

- canonical ingress、Kernel Journal、accepted Project State、Task Report 与 Artifact registry 产生带 `project/run/task/assignment` scope、actor/principal、authority、intent、disposition、revision、source event 和 visibility 的 Workroom Fact。Fact 表达“谁说了/发生了什么”，其正文不自动为真或指令。
- Kernel 签发 Role-bound Execution Envelope，至少固定 execution role、agent definition、project/run/task/assignment、Plan/Task revision、Capability/Policy Snapshot、Context Policy version 与 fact anchor。它同时约束 Context View、Evidence Port、Tools 与 lease；消息、摘要和模型输出都不能改变它。
- Context View Builder 是 `facts + envelope + persisted context policy + token budget → view + audit manifest` 的纯函数。manifest 记录 selected/excluded fact IDs、理由、source sequence、digest refs 和预算；同一输入必须可 replay。authority 决定能否改变状态，relevance 决定是否进入 View，Sponsor lane 决定调度，禁止合并成一个权重。
- Orchestrator View 包含 Project charter/accepted state、当前 Plan、Sponsor directives、Inbox/TaskInput disposition、全局 status/blocker/risk/budget 与 Task Report 摘要；原始执行 trace/tool output 默认不进入 prompt，需要时沿 evidence ref 下钻。
- Executor View 只包含当前 Task contract/acceptance criteria、applied TaskInput、明确标为 untrusted 的 accepted_context、相关 accepted Project facts、直接依赖的 accepted Report/Artifact、自己的 checkpoint/status。其他 Task、普通群聊、Sponsor Room、Agent discussion 与 rejected/stale input 全部排除。
- Reviewer View 只包含 acceptance/risk contract、影响验收的 applied control、candidate Task Report、Artifact metadata、相关 accepted baseline 和 Evidence index；不继承 Executor tool authority，也不读取 chain-of-thought/raw transcript。
- TaskInput 固定保存 source conversation event、actor、authority decision、intent、target 与 `accepted_context | applied_control | rejected | stale`。普通参与者的相关建议可成为 untrusted context；只有 product policy 授权的 control 才成为 mandatory directive。被拒绝输入可在 Orchestrator audit 中出现，但不得被 compaction 重新带入 Executor/Reviewer。
- Task Report claims 必须引用稳定 Evidence/Artifact refs。View 默认只暴露 ref、classification、source 与 metadata；Evidence Port 每次按当前 Envelope/Policy 重新授权正文，并作为 untrusted data 返回。引用不是授权，Reviewer 也不能借此读取其他 Task 或 Console-only trace。
- Context Digest 是按 role + scope + Plan revision 生成的非权威 cache，保存 source fact IDs/hash、actor/disposition、anchor 与 policy version。永不递归摘要 Digest，永不进入 Project State；source/revision/policy 变化即 stale，并从原始 Facts 重建。mandatory policy、Task contract、applied control 与 acceptance criteria 不参与有损压缩。
- Context budget 使用分层确定性选择：Envelope/policy/Task contract/applied control 等 mandatory → accepted state/直接依赖/关键状态 → reports/digests → metadata → recent discussion。mandatory 超预算时返回 `context_budget_exceeded` 并阻止模型执行，不能静默删掉 authority 或验收条件。
- Workroom 中运行 Agent 的新输入必须形成 TaskInput/Plan Revision 和新的 Context View revision；即使底层支持 steer/follow-up，也只能在同一 Envelope 内更新 data context，不能继承发送者或目标 Agent 的工具 authority。

当前实现审计与上述目标没有混淆：现有 `ConversationActor/ConversationTurnCause` 已能保存参与者与控制 turn 归因，但 `ContextRepository.loadContext` 仍返回平面 Session summary + tail，通用 compaction summary 仍是无 provenance 的文本，`TurnExecutionProfile` 也尚未表达 workroom roles。因此生产实现应新增 Fact/View 层并保留普通 chat 路径，而不是把现有 summary 当 Project/Task memory。

原型位于 `packages/im/agent/prototypes/context-view-builder/`，已验证 Alice/Bob 归因、三角色隔离、未授权 control、长群聊噪声、定向 steering、role-specific digest、Plan revision 失效、mandatory budget failure、Evidence re-authorization 与 JSON replay。

## #4: 定义 Project State Memory 投影

Blocked by: #1, #3
Type: Prototype

### Question

如何在 Task accepted 后生成带 provenance 的 State Patch，维护 `verified/assumed/disputed/stale` 事实，并能从 accepted reports/events 重建而不反复摘要旧摘要？

### Answer

采用「immutable accepted sources → Task Memory + State Patch → Project State Snapshot」的事件投影；Project State 是可重建的权威读模型，不复用现有通用 `MemoryEntryRepository` 的自由文本 upsert，也不从 Session compaction summary 继续摘要。

- 可写入语义状态的 source 仅限：`task.accepted` 所绑定的原始 Task Report/Artifact/Evidence、Sponsor/policy accepted Decision 或 conflict resolution，以及 Kernel 的 clock/validity facts。`execution_completed`、进度消息、Agent discussion、Context Digest、聊天摘要和 rejected report 均不得产生 State Patch。
- Acceptance Record 必须逐个 disposition Report claims，并记录 accepted/rejected claim IDs、acceptor/policy、source event 与 acceptance sequence。Task 被 accepted 不代表其每个 claim 自动成为 verified；Project State 只消费明确 accepted 的结构化 claims。
- Task Memory 只在 acceptance 后由原始 Task Report + Acceptance Record 确定性生成，保存 project/run、Plan revision、Task revision、accepted claim keys、decision/unresolved、Artifact/Evidence refs、source hash。摘要只由 accepted claims 生成，禁止复制可能夹带 rejected claim 的自由文本 report summary，更禁止“摘要旧 Task Memory”。
- State Patch 是对 Workroom Profile 的 versioned Project Memory Schema 验证后的声明式 patch，携带 base state revision、acceptance/report/claim provenance、evidence、epistemic status、validity 与显式 supersedes。LLM 与现有 `memory_upsert` 均不能直接修改 Project State；生产实现按 Kernel event sequence/CAS 结算并幂等投影。
- Project Fact 保留 `verified | assumed | disputed | stale`。`verified` 需要 evidence；`assumed` 可带 `validUntil`/validity condition；到期由持久化 Kernel clock/validity event 变为 stale，不能依赖进程本地 timer。
- 同一 semantic key 出现不同 accepted values 时全部进入 disputed，禁止 last-write-wins、按置信度覆盖或用新 Plan revision 静默改写。只有 accepted conflict resolution，或 accepted rework claim 携带精确 `supersedesFactIds`，才能恢复单一当前值并把被替代事实标成 stale。仅创建 rework/Plan revision 不改变既有 accepted state。
- Current Project State Snapshot 是按事实 key 聚合的版本化 cache，展示当前 status/value/source/evidence；disputed 必须显著暴露，stale 默认不注入执行上下文但可审计/显式召回。原始 accepted sources、Journal、Artifact 和 Evidence 才是重建依据，Snapshot 不是新的 source。
- Memory Recall 返回当前事实状态与 provenance、相关 accepted Task Memories 和 Evidence refs；正文仍通过 #3 Evidence Port 依据当前 Execution Envelope 重授权。普通 chat 的 Session/Semantic Memory 继续服务聊天空间，与 Workroom Project State 分库/分写入面，不能相互升级权威。
- `task.memory_created` 与 `project.state_patch_applied` 成功后才发出 `task.execution_context_released`。release 仅允许驱逐 hot prompt、临时 tool trace 和工作 buffer；Journal、Acceptance、Task Memory、Artifact/Evidence、workspace checkpoint 与审计记录不得清理。之后从 accepted sources 按需召回，而非恢复旧 transcript。
- 全量 rebuild 固定按 acceptance/source sequence 重放 source events，重新导出 Task Memories、facts 与 Snapshot；同一输入必须得到 byte-comparable projection。Schema/policy version 进入 source/projection contract，Profile 演进与迁移由 #10 处理，不能在 replay 时偷偷套用 latest schema。

原型位于 `packages/im/agent/prototypes/project-state-memory/`，已验证未验收/拒绝隔离、部分 claim 的确定性 Task Memory、冲突、accepted resolution、返工 supersession、Plan/Task revision provenance、假设过期、上下文释放、按需 recall，以及只保留 accepted sources 后的全量一致重建。现有实现审计确认 `packages/im/ai` 的通用 semantic memory 是 free-form last-write-wins，Session compaction 是无 Project provenance 的文本；生产实现必须新增 Workroom 投影，不能直接升级二者为 Project State authority。

## #5: 定义 Workroom 与 Sponsor Room 投影

Blocked by: #1, #2
Type: Prototype

### Question

如何在 Agent 触发前把 canonical conversation address 显式解析为 `chat/workroom/sponsor_room`，再把 Kernel facts 节流投影为具名 Agent 的群消息和 Console 时间线，并让 reply/mention 产生精确寻址的 TaskInputEvent，同时避免把投影重新当作状态源？

### Answer

采用「Space Resolver → Workroom ingress/普通 chat 分流」与「Kernel facts → per-sink projection outbox → unified outbound/Console」两条单向链路；conversation/IM message 只负责寻址和展示，永远不反推 Kernel 状态。

- Agent ingress 前先以完整 canonical `ConversationRef`（endpoint owner/id、private/group/channel、native id、parent、thread/topic）查询持久化 Space Binding。每个 address 同时最多一个 `chat | workroom | sponsor_room`；无绑定默认 chat。禁止按群聊类型、人数、触发词或模型分类猜场景，现有 `matchAiTrigger`、管理命令与普通 Session 路径只能在 Space Router 判定为 chat 后执行。
- Binding 是带 revision 与 `effectiveAfterConversationSequence` 的 Project registry 事实。显式迁移产生新 revision/anchor；anchor 之前的延迟或 replay 入站一律忽略，不能按新 Space 重新解释。一个 Project 可有多个明确绑定的 delivery views，但每个 address 仍只有一个 ingress owner；Workroom 与 Project 一一对应，Sponsor Room 不拥有 Project。
- Workroom 人类 ingress 先持久化 source conversation event、actor/principal、authority decision、intent 与 binding revision，只进入 Orchestrator inbox。回复或 `@Agent` 只是生成精确 target 的 TaskInput proposal；它们不能直接启动 specialist Turn、切换主 Agent binding 或改变 Task 状态。
- Reply 寻址依靠 durable Projection Message Index：`platform MessageRef → projectionId/source event IDs/project/run/task revision/assignment/agent definition/binding revision`。只接受同一当前 Project 的唯一 target；聚合消息、多 target、跨 binding/project 冲突必须澄清。回复已终结/被 supersede 的 Assignment 仍保留历史 provenance，但降级为 discussion/rework candidate，不能 steer 一个不存在的执行租约。
- 默认单 Bot 代发，消息显式渲染逻辑 `Agent Definition + Assignment` 身份与稳定 target metadata，例如 `[Architect · executor]`；单 Bot 的 logical alias 由 Project Agent Directory 确定性解析，重复/缺失 alias 必须澄清。多 Bot 账号只是 endpoint delivery identity 映射，不能决定 execution role、authority、能力或状态，因而不会出现“每个账号都以为自己是 Orchestrator”。
- Kernel Journal/accepted Project facts 是 projection source。Console timeline 对通过 disclosure policy 的 observable facts 保持 lossless、可下钻；Workroom IM 只展示 run/task 状态迁移、固定时间窗合并的 progress、milestone、blocker、approval、report、accepted/rejected、failure/cancel/conclusion。原始 token、chain-of-thought、完整 tool trace 不刷群；#12 冻结跨 sink classification/redaction。
- 每个 sink 有独立 durable cursor 与 Projection Outbox。Outbox item 固定保存 idempotency key、source fact IDs/sequence、binding/policy version、logical speaker、target、rendered payload、attempt 和 receipt；所有 IM 投递仍走统一 `OutboundMessageService/OutboundHost → renderSendMessage → before.sendMessage → Endpoint`，禁止 projector 直调 Adapter。
- Delivery 是 at-least-once projection：sent/failed/suppressed、重试、平台重复消息或某个 sink 中断都不能回写 Run/Task/Acceptance。支持平台 idempotency/edit 时用于减少重复，但“发送成功而 receipt 丢失”只影响展示，Console 可按 projectionId 对账，不能据 IM 是否出现判断任务是否完成。
- Echo 抑制在 Space ingress 前完成：Adapter/Endpoint 提供可信 self identity，outbox inflight/receipt index 提供 MessageRef provenance；命中任一即标记 `projection_echo` 并忽略。用户复制 Agent 文本不具备 provenance，仍按普通人类消息处理，消息 metadata 不能伪造 projection identity。
- Sponsor Room 是多个 Project 高层 facts 的只读 portfolio projection。查询可聚合；任何 priority/pause/cancel/approval 等写意图必须由显式 `projectId`，或回复单 Project card，解析到恰好一个 Project，并重新检查 Sponsor authority；否则只能澄清/拒绝。成功也只向目标 Project Kernel 提交 control/admission proposal，不直接改 Project projection。
- Projection 可从 Kernel facts + versioned projection policy 重建；Message Index/Delivery Receipt 是投递侧持久状态，不是协作协议。Projection failure 记录诊断并重试，Kernel 无需等待群消息或 Console 才能推进；人类控制则必须先成为 canonical ingress/Kernel event，不能以“群里说过”作为状态依据。

原型位于 `packages/im/agent/prototypes/workroom-projection/`，已验证 chat/workroom/sponsor_room 前置分流、binding migration anchor、Console lossless 与 Workroom 固定窗口节流、具名 Agent provenance、投递失败/重试不改 Kernel、回声抑制、reply/alias 唯一寻址、历史 Assignment 降级、Sponsor 无目标澄清/单 Project control proposal。现状审计确认 `ConversationRef`、ConversationEventStore 和统一 outbound receipt 可复用；缺口是当前 Host 在 Space 解析前执行 AI trigger，outbound conversation event 也没有 logical Agent/source Kernel target，因此生产实现需新增 Agent-owned Space Registry、Projection Outbox 与 Message Index，不能把这些字段塞进文本前缀或现有 Session。

## #6: 定义隔离 Workspace、Integration 与 Compensation

Blocked by: #1, #2
Type: Prototype

### Question

如何为可变 Assignment 提供 worktree/overlay/sandbox，产出可审阅 change set，并用 Integration Task、approval gate 与 capability-declared compensation 处理发布、冲突、取消和不可逆副作用？

### Answer

采用「Workspace Control Plane → immutable Change Set → Integration Task → Effect Ledger」；Executor 只有隔离 workspace 的写权限，canonical target 与外部系统只能由受 policy 控制的 Integration/Effect capability 修改。

- Kernel 为每个 Assignment attempt 签发 Workspace Lease，固定 project/run/task revision/assignment/attempt、backend、opaque mount ref、base revision、mutable scope、expiry 与 fencing token。可变 Task 默认 `git_worktree | overlay | sandbox_volume`，只读 Task 使用 immutable snapshot；共享可写目录默认禁止，确需共享只能由 Plan 声明显式串行 lease/mutex 与冲突策略。
- Workspace Provider 是可信 Host control plane，负责 create/mount/checkpoint/seal/discard/recover；Executor 不能通过 shell 自建 worktree、选择 host path、挂载 volume 或清理别人的 workspace。Turn `policy.filesystem.workspaceRoot` 必须改为 lease mount，而非 Project root；workspace capability 与 Tool/Skill/Network/credential snapshot 继续取交集。
- worktree/overlay 解决并发写隔离，不自动构成安全边界。非可信代码仍在 container/VM/process sandbox 中运行，凭据通过短期 capability port 注入而不是继承 host env；symlink/realpath containment、资源/网络策略和 lease fence 同时生效。Docker 不可用时不得把“软沙箱 + 共享 Project root”宣称为等价隔离。
- checkpoint 持久化 workspace ref、base、manifest 与 fence。pause/preempt/lost 后替补 Assignment 以新 assignment/attempt 和递增 fence 接管；旧执行者的后续写入被拒绝。cancel 在尚未发布时只 seal（若需审计）并 discard lease，不删除 Journal/Artifact，也不需要伪造 compensation。
- Assignment `execution_completed` 只能提交 Task Report + immutable Change Set。Change Set 保存 base revision、path/mode/delete manifest、content/patch refs、producer assignment、hash、Artifact/Evidence/test refs 与风险；它不包含 host 绝对路径。Task Acceptance 可接受该交付物，但 acceptance 绝不自动修改 canonical branch、共享目录或外部系统。
- 多个 accepted Change Sets 由 Plan 中单独的 Integration Task 按持久化顺序消费。它在新的隔离 integration workspace 基于当前 target revision apply/rebase、检测 path/semantic conflict、运行组合检查并产出新的 candidate/Report；生产 Task 的完成顺序不能决定集成顺序，producer 也不能合并自己的结果。
- 同文件/语义冲突或 upstream target 已修改相关路径时，Integration Task 进入显式 blocker/conflicted，保留各候选与 base provenance；producer Tasks 仍可保持 accepted。Resolution 必须形成新的 Integration candidate（必要时 Plan Revision/专门 Assignment）并重新验收，禁止 last-writer-wins、自动 force merge 或让模型直接修改 canonical target。
- Integration candidate acceptance 与 publication 分离。发布前重新按 target revision CAS；target 已移动则本 candidate `stale`，重新创建/rebase Integration revision并重跑 gates，禁止 force push/reset。是否自动提交低风险本地变更、创建 Reviewer 或等待 Sponsor Gate 由 #7 policy 决定；#6 只保证任何 canonical write 都经过显式 Integration/Effect authority 与 durable receipt。
- 所有外部副作用先写 Effect Intent/Ledger，固定 capability/operation、idempotency key、preconditions、risk、reversibility、approval decision 与 target；再执行并结算为 `committed | failed | outcome_unknown`。取消只能阻止尚未开始的 intent；原子外部调用开始后必须等待 receipt 或到 deadline 进入 outcome_unknown，不能因 AbortSignal 就宣称未发生。
- reversibility 只允许 `discard_only | compensatable | irreversible`。`discard_only` 仅指未发布隔离变更；`compensatable` 必须由 capability 预先声明 typed compensation operation 及所需原 receipt（如 close PR、revert commit、redeploy previous release）；`irreversible` 或高风险 effect 执行前必须进入 #7 Approval Gate。
- Compensation 是新的、可审计且可能再次需要审批的 Effect，不是删除原事件。仅 confirmed committed effect 可补偿，并独立记录 `compensated | compensation_failed | compensation_unknown`；失败或未知仍保留 blocker/人工处置路径。无声明 compensation 的邮件、付款等动作禁止由模型临场猜反向命令，也禁止使用“rollback”措辞制造虚假保证。
- Canonical Git rollback 采用新 revert Change Set/Integration Task，不允许历史 reset；部署 rollback 是 capability 声明的重新部署动作。target 在原提交后继续前进时，补偿同样必须重新集成/CAS，不能直接抹掉后来变更。
- Workspace/Change Set/Integration/Effect 都是 Kernel Journal facts，可重放恢复；实际 mount/container 是可重建资源。清理只在 Change Set/Report/checkpoint 已 durable、lease 无 owner 且 retention policy 允许后执行；异常清理失败进入 quarantined/cleanup blocker，但不阻塞 Run 的 cancel/replan 控制面。

原型位于 `packages/im/agent/prototypes/workspace-integration/`，已验证两个 Assignment 从同一 base 隔离修改、accepted Change Set 不自动发布、确定性 Integration、同文件冲突、target CAS stale、checkpoint 替补与 stale-writer fencing、未发布 discard、gated compensatable/irreversible effects、outcome_unknown、补偿成功与失败。现状审计确认 `TurnToolRuntime`、file containment、tool policy 与 sandbox 资源限制可复用；但标准 IM Turn 当前统一获得 `projectRoot`，子 Agent 共享 workspace，Docker workspace 只读而软沙箱可写共享目录，且没有 Workspace Lease/Change Set/Integration/Effect Ledger。因此生产实现必须新增 Agent-owned Workspace Control Plane，并把现有 filesystem authority 收窄到 Assignment lease；不能仅修改 prompt 或增加 Git 使用约定。

## #7: 接入风险分级 Acceptance

Blocked by: #1, #3, #6
Type: Prototype

### Question

如何把确定性检查、Orchestrator 自动验收、按风险创建 Reviewer Assignment、Sponsor gate 统一为可审计 acceptance policy，并保证 Executor 不能自验？

### Answer

采用「versioned Acceptance Contract + conservative Risk Facts + trusted Checks + policy route + optional Reviewer/Sponsor Gate + Acceptance Record」。`execution_completed` 只提交 candidate，唯一能产生 `task.accepted`/`effect.authorized` 的是 Kernel acceptance policy projector；Orchestrator 只能请求求值，Executor、Reviewer 和 Sponsor 都不能直接写终态。

- Task revision 创建时固定 Acceptance Contract 与 Risk Policy Snapshot。Contract 保存 candidate kind、criteria（`deterministic | judgment`）、required Evidence、claim schema 与 policy id；Candidate 只保存 producer Assignment/Agent、Report/Artifact/Change Set refs、完整 claim IDs 和不可变 hash。HMR 或新 policy 只影响新 Contract，不能改变在途 replay。
- 风险不由 Executor 随 Candidate 自报，更不能让 Agent 给一个可操纵的总分；Kernel 从可信 capability/Plan/Artifact/Effect 元数据生成独立、绑定 candidate hash 的 Risk Assessment，维度为 `side effect × reversibility × data class × blast radius × capability tags × uncertainty`，按最高维度的保守 lattice 取 `low | medium | high | critical`。`payment/deploy/send/publish`、restricted data、不可逆动作和未知信息不能被多个低风险维度抵消；缺失 trusted assessment/evidence/check 默认 fail closed。
- baseline policy matrix 固定为：low 且全部 criteria 可机器验证 → policy 自动验收；medium 或存在 judgment criterion → 创建独立 Reviewer Assignment；high/critical 且全部机械可验 → Sponsor Gate；high/critical 且含 judgment → Reviewer 通过后再 Sponsor Gate。Workroom Profile 只能追加 Reviewer/Sponsor tier 或 deny capability，不能降低 baseline；由此 Reviewer 只在风险/criteria 要求时创建，小任务没有固定复核税。
- Orchestrator “自动验收”不是 Orchestrator 模型自报完成：它仅提交 evaluate command，纯 policy projector 读取固定 snapshot 并记录 route/provenance，Acceptance Record 的 acceptor 是 `acceptance-policy:<version>`。同一 Journal facts/sequence 必须得到同一 decision，并用 Kernel append CAS 竞争提交。
- deterministic Check Result 必须来自受信 Check Runner，绑定 criterion id、candidate hash、runner/version、input/evidence refs 与 `passed | failed | error | expired`。failed 直接返工，missing/error/expired 阻止验收；Sponsor 不得豁免硬 criterion、扩大 tool authority 或把未知 effect 认作成功，修改 criterion 只能形成新的 Contract/Task revision。
- Executor 仅能 submit Candidate，不能 evaluate/accept、自写 trusted check、给自己创建 Reviewer 身份或批准 Gate。Reviewer 是 Kernel 按 route 创建的单独 Assignment/principal，使用 #3 Reviewer View，只读 Contract/Candidate/Evidence/Risk，不继承 producer workspace、tool/effect authority；producer 与 reviewer principal 必须不同。
- Reviewer Verdict 必须逐 criterion 给出 `passed | failed | needs_evidence`，并对 Candidate 每个 claim 给出 accepted/rejected disposition 与 Evidence refs。Verdict 是 policy 输入，不直接改变 Task；失败/缺证据进入 rework，新 revision 使旧 verdict stale。Acceptance Record 保存 accepted/rejected claim IDs，供 #4 Project State/Task Memory 只消费明确 accepted source。
- Sponsor Gate 是风险 authority，不是质量 Reviewer。Gate 绑定 candidate hash、Contract/Policy revision、Project/Run/Task/effect scope、owner、deadline 和 `approve | reject | request_changes | cancel`；candidate、target revision 或 scope 变化后旧 Gate stale，不能把一次批准扩散到整个 Run。过期默认不批准，但进入可重新发起/rebase/replan/cancel 的可恢复状态。
- Task/Integration candidate 的验收与 Effect authorization 分离：前者产生 `accepted` Project source，但不发布；后者只产生某个精确 Effect Intent 的 `authorized`，仍由 #6 Effect Ledger 执行并以 receipt 结算 `committed | failed | outcome_unknown`。Sponsor approval 绝不等于动作已发生或可 rollback。
- 所有等待都有 owner/deadline/allowed actions。Reviewer 超时可重新 Assignment、返工或取消；Sponsor Gate 超时可针对仍相同的 digest 重开、rebase 或取消；cancel 由 Kernel 关闭 pending Assignment/Gate，不依赖被阻塞 Agent 回应。reject/request_changes 形成可审计 rework，已 accepted 的旧 Project facts 只有经新 accepted supersession 才改变。
- Acceptance Record 至少固定 candidate/Contract/policy/hash、risk tier/route、check result ids、Reviewer Assignment/Verdict、Sponsor Gate/decision、accepted/rejected claims、acceptor 与 source sequence。投影/聊天/Agent discussion/工具临时 ApprovalPort 都不是验收权威。

原型位于 `packages/im/agent/prototypes/risk-acceptance/`，已验证缺失/伪造 Risk Assessment 被拒绝、低风险确定性自动验收且不创建 Reviewer、硬检查失败返工、Executor 自验拒绝、中风险独立 Reviewer 与逐 claim disposition、高风险机械 Gate、高风险 judgment 的 Reviewer→Sponsor 串联、精确 hash 授权、超时后重开/重新 Assignment/取消、replacement 使旧 Gate stale、未知风险 fail closed、Effect 只 authorized 不伪造 committed，以及 policy snapshot 固定 replay。生产吸收 revision 1 已移除公开 `accept_task`，增加 Kernel-owned `WorkroomAcceptancePolicyDecisionPort` 和低风险机械候选的 CAS Acceptance Record；Kernel 会拒绝端口错误建议的高风险自动验收。Turn `ApprovalPort` 仍只是临时工具确认，不能复用为 Workroom 验收；generation/Profile pin、Reviewer/Sponsor 与 accepted-source projector 继续由 Production Ledger P7 追踪。

## #8: 接入 Remote A2A Executor

Blocked by: #1, #2, #3, #6, #7
Type: Prototype

### Question

如何让 A2A Executor 复用本地 lease/event/report 契约，以 GitHub repo/base revision/branch/PR 作为共同 workspace 引用，并在失联、重复 callback 和接管时保持幂等？

### Answer

采用「same Kernel Assignment → durable A2A Dispatch Outbox → Remote Execution Link/Callback Inbox → typed Task Report/Candidate」；Remote A2A 只是 Executor transport，Project/Run/Task/Assignment、lease/fence、acceptance 和 Project State 永远留在本地 Kernel，不创建 `remote_mesh` 专用状态机。

- Remote Executor 与 local Executor 使用同一 Task/Assignment lifecycle、Role-bound Execution Envelope、Capability Snapshot、Context View、Workspace Lease、Task Report 和 `assignment.execution_completed` 事件。A2A `taskId/contextId` 只是外部 receipt，保存在 Remote Execution Link；不能成为依赖、Project Memory key 或本地状态 SSOT。
- Remote endpoint 必须由 Project/Profile 可见的 Integration Capability 注册，固定 endpoint owner、认证 binding、tenant、Agent Card digest、信任域与 generation snapshot。Workroom Assignment admission 还要求 versioned A2A extension 声明 idempotent dispatch、typed Completion Envelope 和受支持 workspace provider；普通 text-only A2A Agent 只能做非权威 discussion，不能 claim Assignment。
- Kernel 在网络 I/O 前持久化 Dispatch Envelope/Outbox。Envelope 绑定 project/run/task revision/assignment/attempt/fence、endpoint/Card snapshot、Context View ref/hash、Acceptance Contract、Capability Snapshot、Disclosure Manifest 与 Workspace Lease；`dispatchId/messageId` 首次生成后固定。发送未知或重试必须复用同一 idempotency key，禁止每次 retry 生成新 A2A task。
- A2A wire 使用明确 extension URI 与 typed data part，普通文字只用于人类可读说明。不得传 host path、GitHub token、模型 session history 或可自行扩权的 tool list；远端只收到已授权的不可变 refs 和 capability grant ref，credential 由各自可信 Integration Gateway 解析。
- Remote Execution Link 是 transport projection，保存 local Assignment ↔ endpoint/dispatch ↔ remote task/context、send receipt、callback cursor、reconcile deadline 与 terminal receipt 的映射，但不另存 Task status。Push/SSE 只优化延迟；正确性必须能由持久化 outbox、A2A `GetTask`/typed snapshot 与 Kernel clock 恢复，禁止依赖 process-local polling timer/running map。
- authenticated callback 先进入 durable Callback Inbox，以 `endpoint + remote event id + canonical payload hash` 去重。完全重复为 no-op；同一 id 不同 hash 进入 security/conflict blocker；push sequence gap 不应用 terminal，改为 bounded reconciliation，再以完整 poll snapshot 收敛。A2A v1 本身没有满足 Workroom 所需的稳定 callback sequence/completion schema，因此这些是 Zhin Workroom extension 契约，不能藏在自由文本里。
- Callback transport auth 只证明字节来源，不能直接改 Task。adapter 必须重新验证 dispatch、Assignment/task revision/attempt/fence、endpoint/remote task link、callback cursor 和 typed schema，再通过 Kernel `append(expectedSequence, events)` 提交普通 progress/heartbeat/failure/execution-completed event；并发 lease expiry 与 completion 由 Journal CAS 顺序决定唯一结果。
- GitHub shared workspace 固定为 canonical repository ID、immutable base SHA、target ref、per-attempt branch、path scope、integration binding、mode（branch-only/PR）与 fence，不使用本地路径。可变远程 Assignment 必须写独占 branch/fork；canonical branch 由 protection + Integration capability 控制，Remote Executor 不能 merge/force-push。
- GitHub credential 不通过 A2A 发送。强隔离需要按每次操作检查 lease/fence/ref/path 的 Integration Gateway，或足够短期、受限的 GitHub App grant + protected branch；仅给远端一个宽泛 repo write token 不能宣称实现了 Workspace Lease。push/PR 本身按 #6 Effect Ledger 与 #7 risk policy 预授权、记录 receipt 和必要 compensation。
- Completion Envelope 必须绑定 report/candidate/claims/evidence，以及 leased repository/base/branch 的精确 `headSha`；PR 模式还固定 PR ref 与同一 `prHeadSha`。它只产生 `assignment.execution_completed → awaiting_acceptance`。PR 后续移动、checks 变化或 target 前进都会使 candidate stale/需重新集成，remote “completed” 绝不等于 accepted、merged 或 deployed。
- heartbeat 可触发 Kernel 按固定 policy 延长 lease，远端不能自选期限。失联/lease expiry 后旧 Assignment 进入 `lost + outcome_unknown`，Scheduler 可创建更高 fence 的 replacement；replacement 使用新 attempt branch，可显式从已 seal 的 checkpoint commit 开始，但绝不复用旧 mutable branch。旧 callback/late push/PR 均保持可审计且对新 Task 状态 stale。
- cancel/preempt 是有 control deadline 的 best-effort A2A control。ack 可结算 interrupted；无 ack 到期也必须释放本地控制为 cancelled/lost + outcome_unknown，并保留 effect reconciliation，不能无限等远端，也不能把 Abort/HTTP success 当作“远程一定停止”。
- Agent Discussion、A2A status 文本和普通 Artifact Update 都是非权威 observation；只有匹配 extension 的 typed completion 能提出 Task Report Candidate，之后仍走 #7 Acceptance。Remote Agent 自己内部如何多 Agent 协作不改变这条边界，也不能通过 callback 创建 Task、改 Plan、接受结果或更新 Project State。

原型位于 `packages/im/agent/prototypes/remote-a2a-executor/`，已验证固定 dispatch identity 与未知结果重试、callback 完全去重/冲突/gap + poll reconciliation、discussion 非权威、typed GitHub base/branch/head/PR receipt、lease expiry、checkpoint takeover/new branch fencing、旧 callback stale、两阶段取消超时，以及 remote completion 只到 awaiting_acceptance。现状审计确认 `packages/host/a2a` 目前是 inbound Host，使用 `InMemoryTaskStore` 与进程内 running map，把 A2A 请求启动为普通 Agent Turn；被删除的旧 outgoing `remote-task-executor.ts` 则依赖随机 request identity、进程内 stream/poll 并从 remote status 直接 complete/fail Task。生产实现应新增 Agent-owned outbound Remote Executor Port 与 durable outbox/callback/reconciler，不能恢复旧 `remote_mesh` 双轨。

## #9: 收敛旧多 Agent API 与迁移路径

Blocked by: #1, #2, #3
Type: Discuss

### Question

现有 `SubagentSystem/spawn_task`、`runPipeline/runParallel/route`、AgentDispatcher 与 remote_mesh 哪些降级为 convenience/Executor，哪些删除或 deprecate，如何避免长期双轨？

### Answer

采用一次性 breaking cutover：只保留「普通 chat 的临时委派」和「Workroom Assignment 的统一执行端口」两个互不相认的执行边界；旧 API 不做 runtime deprecated wrapper、双写、双读或 fallback。名称相似不代表可以共享 task identity、状态或记忆。

| 旧表面 | 判定 | 目标位置 | 硬边界 |
| --- | --- | --- | --- |
| `SubagentSystem` / `spawn_task` | 保留为 **chat-only convenience**；`SubagentRuntime` 可被本地 Executor 复用模型执行能力，但不能复用其进程内 task lifecycle | 普通 chat 的 `ChatSubagent` 能力；Workroom 侧另建 `LocalAssignmentExecutor` adapter | `spawn_task` 在 Workroom Context View/Tool Snapshot 中不可见；其 task id、完成通知、session history 与 auto-continue 永不成为 Workroom Fact、Task Report、Acceptance 或 Project Memory |
| `runPipeline` / `runParallel` / `route` | 删除现有“立即调用 `AIService.runAgent`”的执行 API；熟悉的串行/并行/分支表达只可重生为纯 Plan builder | `WorkflowPlanBuilder` / `WorkflowStrategy`，输出 versioned Task DAG proposal | builder 不接收 `AIService`、不执行 Agent、不等待 Promise、不保存状态、不决定 acceptance；真正执行只经 Kernel applied Plan → Scheduler → Assignment Executor |
| `AgentDispatcher` | 删除，不 deprecate | capability/availability 匹配归纯 Scheduler decision；交付归 durable Assignment Dispatch Outbox/worker；状态归 Journal projection | 不存在 mutable task map、`recordResult`、`canExecute` 或第二个 terminal writer |
| `remote_mesh`、`RemoteAgentRegistry`、poller | 删除，不保留配置别名 | `RemoteAssignmentExecutor` 作为与 local 同构的 `AssignmentExecutorPort` adapter；endpoint 能力来自 generation/Profile snapshot | A2A task/status 只是 transport receipt/observation，不能直接 complete/fail/accept Workroom Task |
| 固定 five-agent workflow strategy | 删除执行策略；角色模板可作为 Profile/Agent Definition 示例保留 | #10 的 versioned Workflow Strategy + Capability Pack | 角色字符串和静态 tool allowlist 不是 authority；每次 Assignment 以 Execution Envelope 的 capability/policy snapshot 为准 |
| `AgentResourceHub` tool/skill/subagent/MCP/hook registry | 保留资源注册职责，不是 Workroom Orchestrator | Agent capability/resource module | 它不生成 Plan、不调度 Assignment、不写 Workroom Journal；`Orchestrator` 只指 Workroom 中受 Envelope 约束的协作角色 |
| schedule 侧 `TaskExecutor` | 保留，但明确属于独立 Schedule execution domain | schedule module | Schedule Job 不是 Workroom Task；若未来接入 Workroom，必须通过显式 Inbox/Plan admission，不能因同名共享状态 |

目标执行接口刻意保持很窄：Kernel 签发不可伪造的 Assignment Execution Envelope；`AssignmentExecutorPort` 只接收这份 envelope 并提交 progress、heartbeat、checkpoint、typed report/candidate 等 observation。Local 与 Remote 是这个 seam 的两个真实 adapter。Executor 不获得任意 `runId/taskId/owner/clock` 参数来替别人 claim、accept 或推进状态；Scheduler 也只返回确定性 decisions，网络交付由 outbox worker 完成。由此删除 `AgentDispatcher` 后没有必要再造一个同义 class。

Workroom 的模型工具也必须随迁移收窄。当前生产切片中的通用 `workroom_transition` 暴露 `claim_task`、`accept_task`、`advance_clock` 等任意命令，只适合原型验证，不能成为最终 Agent API。目标表面按 principal/role 拆分：Orchestrator 只能提交 Inbox disposition、Plan proposal/revision 与 control request；Executor 只能对当前 Envelope 上报 progress/checkpoint/execution completion；Reviewer 只能提交 verdict；Sponsor 决策来自可信人类 ingress；Kernel clock、claim、lease recovery、acceptance projector 与 dispatch worker 没有模型工具。所有 identity/scope 从当前 Envelope 注入，模型不能自填其他 Project/Run/Assignment。

迁移采用一个 major release 内的单写者切换，而不是跨版本长期兼容：

1. 先落目标 Journal schema、role-scoped command ports、Scheduler 与 Local Assignment Executor，并用同一 E2E 证明 Plan → dispatch → report → risk acceptance → projection；切换前旧 writer 仍可运行，但新旧 writer 不允许在同一进程同时启用。
2. 在同一个 cutover commit 删除旧 exports、实现、数据库 mutable models、Console route、配置 schema 与文档；删除 `zhin.js/agent` 的执行型 `runPipeline/runParallel/route`，新增的 Plan builder 使用不同名称和返回类型，避免旧调用“看似成功但语义已变”。`spawn_task` 文案、prompt 与 tool selection 明确限定 chat，Space Router 判定为 Workroom 时必须物理移除它。
3. 启动时遇到 `ai.remoteAgents`、`remote_mesh`、旧 orchestration tool/config key 或旧 import surface 要明确失败并给迁移指引，不能静默忽略或映射到新状态机。API snapshot、config harness 与 forbidden-symbol harness 同时阻止旧 writer 回流。
4. 旧持久化 Run 只提供离线只读导出/审计，不自动恢复为新 Assignment。旧 `completed` 没有 claim-level Acceptance Record，不能升级成 `accepted` Project State；迁移工具最多把目标、输入、artifact ref 与历史结果作为带 `legacy_import` provenance 的 untrusted Inbox/Evidence 候选，由 Sponsor 显式 replan/re-accept。升级时仍 active 的旧 Run 标记 `migration_required`，必须可导出、取消或重规划，禁止两套 runtime 继续抢占。
5. changeset 对 `@zhin.js/agent`、`zhin.js`、CLI/Console 及受影响契约包标记 major，逐项列出 removed export/config/route、替代 API 与数据处理规则。完成标准不是“类型能编译”，而是 repository-wide 搜索无旧生产符号、无第二状态 writer、普通 chat `spawn_task` 不产生 Workroom event、Workroom Agent 看不到 `spawn_task`，local/remote adapter 对 Kernel 产生同构事件，旧数据不会被误认作 accepted。

现状审计：当前工作树已经删除旧 `OrchestrationService/Kernel`、mutable repositories、`AgentDispatcher`、five-agent executing strategy、remote registry/poller、旧 Console route，以及执行型 `zhin.js/agent` pipeline APIs，并增加了 major changeset、breaking migration matrix 与 `check:workroom-ssot`；`spawn_task` 也已移除 `run_id/task_id` 和 Session→Run 隐式创建。资源中心已以 `AgentResourceHub` 公开且无旧名 alias；仍未完成的 #9 项目包括旧数据导出/拒绝策略与全链验收，不能因单个 tracer 完成就宣告 #9 全部上线。

## #10: 定义领域 Workroom Profile 与受治理演进

Blocked by: #3, #4, #7
Type: Prototype

### Question

如何用 domain/competency/integration/policy 四类 Capability Pack 组合 Project Charter、Agent Definition、Workflow Strategy、Tool/Skill、Memory Schema 与 Glossary，使不同领域共享同一 Kernel，并从 accepted knowledge 生成可解释、可回滚的 Profile Revision？

### Answer

采用「immutable Pack supply + Project-local Profile Overlay → compiled Profile Revision → Run-pinned snapshot」。通用 Workroom Kernel 只理解 Project/Run/Task/Assignment/Journal/Acceptance 等稳定契约，不理解“软件研发、内容制作、投资研究”等行业词；领域差异全部在 Profile compiler 输入和 role-specific Context/Capability projection 中表达。

- Project Charter 不属于可复用 Pack。它是 Project 自己的版本化目标与约束；Workroom Profile Revision 精确绑定 Charter revision、Capability Pack `id/version/digest`、Project-local Overlay、来源与父 revision。Pack 是跨 Project 可复用供应物，Overlay 是该 Project 从 accepted knowledge 学到的术语、可选 Memory field、工作参数与已授权能力选择，禁止直接修改共享 Pack。
- Capability Pack 只有四类：`domain` 提供领域 Glossary、Memory Schema、Agent Definition 和典型 Workflow Strategy；`competency` 提供可跨领域复用的 Skills/方法；`integration` 描述 Tool implementation、外部系统 binding 与可用 operation；`policy` 提供 deny、风险/Reviewer floor、验收和披露约束。复合领域可选择多个 domain pack，但冲突必须显式解决，不能用数组顺序或 last-writer-wins。
- Pack 是 immutable、content-addressed、owner/version 可审计的 generation capability。Profile 必须固定 digest；相同 `id@version` 内容变化直接拒绝。相同 canonical Tool/Skill/Agent/Workflow id 来自多个 Pack 时，仅完全相同 digest 可去重，不同实现必须报 composition conflict。Pack dependency 同样固定 digest，防止依赖名未变而供应物被替换。
- Profile compiler 是纯深模块：`generation catalog snapshot + Charter revision + exact Pack refs + Overlay → Compiled Profile + diagnostics + digest`。它验证 dependency、Glossary/Memory Schema 冲突、Skill prerequisite closure、Integration 所需 Tool、policy deny、Workflow DAG capability requirements，以及每个 required Task 是否至少存在一个满足 role/capability/authority ceiling 的 Agent Definition。required Workflow 不可满足时 Profile Revision 不可激活；optional Strategy 可带不可用诊断留在目录中，Orchestrator 不能静默降级执行。
- “Pack 提供”仅表示 available supply，不表示 Assignment 获权。Assignment Capability Snapshot 固定为 `generation available ∩ Profile enabled ∩ Agent Definition ceiling ∩ Task requirement closure ∩ Policy admissible`。Skill 只贡献指令与 required Tool closure，不能授予 Tool；Task 未声明或 Profile 未授权的 sibling Tool/Skill/Integration/authority 不装载。缺项形成 Capability Request/Plan blocker，不允许把整个 Profile 或 Agent ceiling 填进 prompt/tool list。
- Workflow Strategy 是可复用的 Plan proposal template，不是执行器。Task template 声明 role、依赖、required capability/authority、acceptance/memory contract；Orchestrator 可根据 Inbox/Project State 动态选择、参数化或组合 Strategy，但最终仍提交 #2 的 versioned Plan Revision。Profile 参数不能藏入 authority/risk policy；涉及能力和验收的字段必须使用 typed contract。
- Profile Curator 可从 #4 accepted Task Memory/Acceptance Record、accepted Sponsor Decision 或受信 Pack publication 提出 Profile Revision；Agent discussion、普通聊天摘要、execution-completed report 或 Context Digest 都不是有效 source。自动“学习”只代表自动生成可解释 proposal，不代表模型可以静默自我修改。
- governance 按语义 diff 判定，而不是信任 proposal 标签。accepted Glossary、可选 additive Memory field、Workflow 参数和已在 Profile 内可见且不增加 Tool closure 的 Skill selection，可由固定 policy 自动激活；Project Charter 变化、破坏性/required Memory Schema migration、增加/升级 Pack supply、增加 Tool、外部 Integration、authority、自动验收范围或降低 Reviewer/policy floor，一律绑定精确 compiled digest 等待 Sponsor。Profile/Policy Pack 只能加严 #7 baseline，不能声明自己有权放宽 core safety。
- Profile Revision 激活只改变 Project 的 active pointer，并默认仅供新 Run 使用。每个 Run 固定 Profile revision/digest；在途 Assignment 固定自己的 Capability/Policy snapshot，HMR、Pack publication 或 Profile activation 都不能静默换包。若在途 Run 需要升级，必须提交显式 rebase，重新编译 Plan/Context/Capability/Acceptance 并处理 stale Assignment/Gate。
- rollback 不移动指针或删除历史，而是创建一个以当前 revision 为 parent、`restoredFromRevisionId` 指向旧 revision的新 proposal；它重新经过相同语义 diff governance。移除能力的 exact rollback 可由 safety policy 激活，若旧 revision 相对当前重新扩大 Tool/authority/policy，则仍需 Sponsor。Rollback 不补偿已发生 Effect，外部副作用继续由 #6 Effect Ledger/Compensation 处理。
- Project-local 学习不会自动发布为共享 Pack。要让多个 Workroom 获益，Curator 另提 Pack candidate，保留贡献 Project 的 accepted provenance，经 Pack owner 的 schema/check/review/Sponsor 或维护者发布流程产生新 `id/version/digest`；其他 Project 仍需显式 Profile Revision 采用，避免一个 Project 污染全局专业能力。

原型位于 `packages/im/agent/prototypes/workroom-profile/`，以软件研发与内容制作两个异构 Profile 复用同一个 evidence competency pack，验证了 exact pack digest、required Workflow capability diagnostics、Skill→Tool closure、Assignment 最小装载、跨 Project Glossary/Memory 隔离、accepted knowledge policy activation、未验收来源拒绝、Tool/外部访问/authority/auto-accept expansion 的 Sponsor gate、Run pin、非破坏 rollback，以及同名不同 digest 冲突。现状审计确认 Plugin Runtime 已有 generation-owned Tool/Skill/Agent capability catalog 和 Turn capability snapshot，可作为 Pack compiler 的 available supply；但尚无 Project-scoped Profile registry/compiler、Pack manifest/publisher、Workflow requirement schema、Memory Schema registry 或 revision governance。生产实现必须复用现有 capability catalog，不能另建第二套 mutable Tool/Skill registry。

## #11: 定义跨 Project 资源准入与 Portfolio 调度

Blocked by: #2, #5, #10
Type: Prototype

### Question

当多个 Workroom 共享同一批模型、Executor、费用与速率上限时，如何在不合并 Project queue/memory 的前提下，由 Sponsor Room 表达跨 Project priority、预算和暂停策略，并保证单个 Project 不能垄断资源或让低优先级 Project 永久饥饿？

### Answer

采用「Project-local scheduling → opaque Capacity Request → Portfolio Admission → fenced Capacity Grant → Workroom claim/settlement」的两级调度。两级之间只交换资源契约，不交换消息、Context、Task title、Artifact 或领域记忆；因此 Portfolio 不是“总 Orchestrator”，也不会成为第二个 Task/Run 状态机。

- Workroom Scheduler 仍按 #2 的 Sponsor lane、依赖、deadline、local rank、starvation 与 Plan revision 选择 Project 内 head。它可以按 Project policy 暴露有限个可并行 head，但必须带本地 `schedulerSequence/localOrder`；Portfolio 只比较各 Project 已选出的不透明请求，不能越过 head、读取完整队列或选择另一个 Task。Project 用请求洪泛扩大调度权的行为由 `maxOutstandingRequests/maxConcurrentGrants` 限制。
- `Capacity Request` 只包含 `projectId/requestId`、opaque Run ref、scheduler sequence、Profile digest、preemptibility、deadline 和 Resource Bundle demand。禁止携带 prompt、消息、Task title、Context、Memory、Tool 参数或 Evidence。Portfolio priority 来自可信 Sponsor Portfolio Policy 或绑定 exact request 且有 expiry 的 Priority Override，不能由消息 metadata、Agent 或 Workroom 自报。
- Resource Bundle 将模型 endpoint、Executor/sandbox、rate unit 和计费估算作为多个 Resource Pool demand 原子准入；要么整包授予，要么不占任何资源，避免先占模型再等 Executor 的跨池死锁。Pool/price/rate catalog 来自 generation-owned 可信资源；Capacity Grant 不能授予 Profile/Assignment Snapshot 中原本不存在的模型、Tool、Skill 或 authority。
- `Capacity Grant` 是资源 reservation/lease，不叫模糊的 capacity token。它固定 request、resource bundle、预算 reservation、Portfolio/Project policy revision、offer/lease expiry 与单调 fencing token。Workroom Kernel 必须在 offer TTL 内把它绑定自己的 Assignment attempt；只有 Workroom Journal 能因此 claim/dispatch 或改变 Task/Run 状态。重复或过期 fence 不能接管资源。
- Portfolio policy 对每个 Project 保存 `lane + weight + hard budget + allowed pools + concurrency/outstanding caps + starvation bound + active/paused/reclaim_checkpointable`，另有全局预算和每个 Pool 的 capacity/rate/price。Sponsor Room 只是这些事实与命令的 projection：跨 Project 提升、预算调整、暂停和恢复都产生带 principal、target、revision、reason 的 Portfolio Journal event，不直接改 Project Plan 或 Memory。
- 非饥饿排序采用两层规则：达到持久化 starvation deadline 的 Project 在下一次可满足的 capacity opportunity 优先；否则先比较 Sponsor Portfolio lane，再用按 Project weight 归一的历史 dominant-resource service 比较公平份额，最后才看 deadline、request sequence/id。这样同 lane 可获得近似权重份额，持续 urgent 流量也不能永久压住 low。这里保证的是“可用容量机会界”，不是在不可中断原子动作占满资源时承诺不可能的绝对墙钟时间。
- 所有运行中 grant 都是有限 lease。低优先级 `checkpointable` grant 被更高优先级或 starvation reservation 挡住时，Portfolio 只能发 `Capacity Reclaim`，由拥有 Assignment 的 Workroom 按 #1/#2 在安全点 checkpoint、释放 lease 并确认；Portfolio 不可直接 abort/cancel Task。`atomic` grant 不抢占，只能完成、结算或 lease 失效。暂停默认停止新准入；`reclaim_checkpointable` 只请求回收安全工作，原子工作继续，真正 cancel 仍走对应 Workroom Control Plane。
- 预算在 grant 前按可信 price catalog 和声明的最大 usage reservation；Project 与 Portfolio 两级余额均足够才可发放。offer 未消费即过期时释放预算/rate reservation；已消费 lease 丢失只释放物理 capacity，费用保持 `usage_unknown` 并阻止可能重复的重试/超支，直到 provider/Executor 的可信 Usage Receipt 结算。实际费用高于 reservation 也按实记录并使账户 over-budget，禁止截断成预算内结果。
- Portfolio Journal 是唯一资源事实链，request、policy、override、grant、consume、reclaim、expiry、usage receipt 全部幂等且可重放；生产实现用 `append(expectedSequence)` CAS、grant/reclaim outbox 和 reconciliation worker 支持多实例与重启。墙钟只产生 Kernel clock event，HMR 不改已签发 grant 的 policy snapshot。累计公平服务需要显式 normalization event，不能用进程内计数静默归零。

原型位于 `packages/im/agent/prototypes/portfolio-admission/`，验证了原子多池 bundle、请求内容隔离与 payload-sensitive idempotency、2:1 weighted service、持续 urgent 下的 low starvation bound、Project/global budget reservation、lost lease 的 unknown usage、late receipt reconciliation、跨 Project checkpoint reclaim、atomic 不抢占、Project-scoped authority、offer expiry/fence retry 和 replay。现状审计确认 `ScheduleExecutionQueue` 是 schedule 域的进程内 Promise 队列、AI `RateLimiter` 是进程内用户窗口、`BudgetGuard` 是单次执行 abort guard；三者都可贡献实现经验或 enforcement signal，但不能被提升为 Portfolio durable authority，也不能与 Workroom Scheduler 混成一个队列。

## #12: 定义 Fact/Artifact 数据分类、保留与披露策略

Blocked by: #3, #5, #10
Type: Prototype

### Question

不同领域 Workroom 如何为消息、Fact、Digest、Task Report、Artifact 与 Evidence 声明 privacy/classification、租户边界、保留期、脱敏和地域策略，并让 Context View、Evidence Port、Workroom projection 与 A2A delivery 使用同一披露判定，避免摘要或跨 Agent 交接泄露敏感数据？

### Answer

采用「content-free Data Header + governed Payload Vault → current Data Governance Policy → one Disclosure Decision / Retention Plan」。`classification` 只表示保密等级，不能继续兼任隐私、租户、地域、保留期和受众；所有 Workroom 数据都绑定正交的 Data Descriptor，Context View、Evidence Port、Workroom/Sponsor projection、Console 与 A2A 只能通过同一个 policy module 获得正文或派生物。

- Data Descriptor 至少固定 object/hash、tenant/Project、data kind、`public | project_internal | confidential | restricted | unknown` confidentiality、data categories、pseudonymous subject refs、allowed purposes、storage/processing regions、Retention Class/window、source lineage、transform ref 与 classification policy revision。`personal_data/credential/financial_data/customer_content/market_sensitive/direct_identifier` 等是可组合 category，不是更长的 confidentiality enum；领域 Profile 可增加 category/schema rule，但通用 Kernel 不理解行业正文。
- classification 来自可信 ingress/schema classifier 与 baseline/Profile floor 的保守 join。Agent、消息 metadata、Artifact producer 或远端 A2A 可提高标签或请求复核，不能降低 floor。无法分类、解析失败或未知地域/tenant 的 bytes 进入 quarantine，任何模型、投影、Evidence 或 A2A 都看不到正文；“先给模型看再让它分类/脱敏”被禁止。
- Workroom Journal、Acceptance/Effect/Projection Journal 只保存 content-free header、hash、provenance、decision、manifest、tombstone 与 purge receipt；敏感正文/文件/chunk 放在加密、带 location manifest 的 Payload Vault。这样 event sourcing 的不可变审计与 payload expiry/erasure 不冲突。Journal 内若直接嵌正文，就无法诚实实现 purge，生产 schema 必须先拆 header/ref。
- Data Governance Policy 是一个深模块。统一输入为 `Data Descriptor + Role-bound Envelope/principal + exact purpose + channel + Processing Destination/recipient snapshot + current policy revision + exact approvals`，统一输出只允许 `allow_full | allow_metadata_only | transform_required | approval_required | deny`，并给稳定 reason codes/audit manifest。各 adapter 只能执行决定，不能为 IM、Console、model 或 A2A 各写一套“差不多”的过滤器。
- confidentiality 只是判定的一维。tenant mismatch、未授权 Project crossing、purpose 不符、credential 进入普通 data port、未知/不允许 processing region、未禁止训练/留存的外部 processor、recipient membership/clearance 不足均可独立 hard deny；Sponsor/Compliance approval 不能越过 hard deny，也不能借披露批准扩大 Tool/Skill/Effect authority。Secret 只能经独立 capability port 使用，不通过 Context/Evidence 正文传播。
- Processing Destination 必须是 generation-owned contract：固定 provider/endpoint owner、tenant/Project、trust domain、contract digest、processing regions、classification/category ceiling、training/logging/retention behavior、recipient membership revision 与 deletion support。所谓“本地模型”“内部 Console”“同一个群”只是名称，不能代替这些事实。IM 平台也是 external processor；Console 也要按当前 principal/tenant/clearance 判定，#5 的 lossless 只表示“对允许观察的 facts 无损”，不表示 raw secret 永远可见。
- Context View Builder 在把 Fact 交给具体模型 endpoint 前逐项判定；Evidence ref 只暴露经过 policy 允许的最小 metadata，正文每次下钻重判；Workroom/Sponsor projection 以群成员 snapshot 和 sink contract 判定，默认只发去标识状态；A2A Dispatch Envelope 携带 materialized Disclosure Manifest，不再只放一个不可验证的字符串 ref。跨 Project 即使同 tenant 也默认禁止，允许时需要 exact source/target/purpose export approval；跨 tenant 永远不能靠 Sponsor Room 消息放行。
- 派生物不会天然变安全。Context Digest、summary、Task Report、Artifact、projection payload 与 Agent hand-off 默认继承所有 source 的最高 confidentiality、category/subject lineage 并取 purpose/region/retention 的交集；source window 不相容则禁止生成。禁止摘要 Digest，也禁止 LLM 通过“我已匿名化”降级标签。source/policy/recipient membership 变化使 cache/approval/manifest candidate stale，并从原始 header/source 重判。
- minimization/redaction 必须是受信、版本化、确定性的 Transform，对 typed field/span/chunk 运行，保存 input/output hash、rule/verifier、lineage 并产生新的 Data Object，不覆盖 source。masking/pseudonymization 仍是 personal data；只有 policy 声明且 verifier 证明不再可关联 subject 的 deidentification 才能移除 subject linkage。若 transform 输出仍超 destination ceiling，不能重复套用同一个“打码”标签假装合规。
- external delivery 是 Effect。发送前先 materialize exact output，Disclosure Manifest 绑定 source/output hash、purpose、channel、principal/Assignment、destination contract/membership、policy revision、approval ids、expiry 与 re-disclosure/deletion capability；再进入 Projection/A2A outbox。Approval 只能由可信 Data Steward/Compliance principal 写入 Governance Journal，并绑定同一 request digest；request/message metadata 自带的 `approved` 一律无效，内容、受众、地域、purpose 或 policy 任一变化即 stale。发送后无法保证召回时，审计保留 irreversible/unknown external copy，而不是删除记录冒充从未披露。
- retention 同时有 policy minimum 与 maximum：Profile/baseline composition 取窗口交集，不能笼统认为越短越安全。maximum 到期或合格 subject erasure 触发 Purge Plan；minimum、active Retention Hold 或其他受信 policy obligation 可阻止提前清理。Hold 必须有 exact scope、owner、reason、reviewAt 与显式 release；review overdue 只升级 blocker，不自动释放，也绝不授予 read/disclosure。
- Purge 是多位置两阶段控制：先持久化 primary/index/cache/replica/backup/processor deletion intents，再收 authenticated receipts；任何 `outcome_unknown` 保持 reconciliation，禁止提前删 header或宣称完成。所有位置确认后删除 payload/key，留下最小 descriptor hash、lineage、hold/erasure/receipt audit。外部 processor 删除是新的 best-effort Effect；不支持删除的既有 disclosure 只能如实报告。Evidence payload 过期后，Data Governance 只发 `payload_unavailable` fact；是否使 accepted claim stale/需 rework 由 #4/#7 policy 决定，Retention 不能直接改 Project State。
- Profile Policy Pack 只能相对 core baseline 加严：提高 category/kind floor、收窄 region/destination/purpose/channel ceiling、增加 approval/retention obligation、选择受信 Transform；不能发布自定义“允许”绕过 tenant/credential/unknown hard deny。Run 可固定普通 execution policy，但 Data Governance 是当前安全 overlay：更严格 revision/hold/revocation 立即使在途 View/approval stale；较宽松的新 policy 不自动扩大旧 Envelope，必须显式 re-authorize/rebase。

原型位于 `packages/im/agent/prototypes/data-governance/`，用客户支持与投资研究两个 Profile 验证了 category floor、unknown quarantine、同一 disclosure interface 覆盖 model/IM/Console/A2A、群 membership digest、residency/tenant/credential/no-training hard deny、exact Compliance approval、可信 transform、摘要不降级、打码/单账户聚合仍保持 subject-linked、Profile 不可弱化 baseline、minimum/maximum retention、Hold overdue、subject erasure、多位置 purge、unknown receipt reconciliation、payload purge 后 content-free audit replay。现状审计确认 `WorkroomFact.visibility`、A2A `disclosureManifestRef` 和 risk `dataClass` 仍是互不相连的占位字段；现有 request/env redaction 只保护日志，通用 Session summary/按时间消息清理没有 Workroom lineage/subject/region/hold，不能复用为本模型。至 #12，决策地图的当前 frontier 已全部解决；后续进入 production Ledger，而不是继续扩张另一套原型状态机。
