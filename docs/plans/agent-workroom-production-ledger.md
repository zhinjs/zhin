---
sidebar: false
---

# Agent Workroom 生产化 Ledger

本文件追踪决策原型已经证明、但尚未吸收到生产模块的工作。决策地图回答“应该怎样”；本 Ledger 防止原型结论被误认为已经上线。只有代码、迁移、测试和文档全部完成后才能勾选。

## P7：Risk-tier Acceptance

Status: in_progress
Source: decision map #7 and `packages/im/agent/prototypes/risk-acceptance/`

- [x] 从公开 `WorkroomCommand` / Agent tool 中移除无约束 `accept_task`；Executor、Orchestrator 模型、Reviewer 与 Sponsor 均不能直接产生 `task.accepted`。
- [ ] 增加 Kernel-owned Acceptance Policy Decision Port，唯一负责根据 pinned policy snapshot 追加 acceptance events，并使用 Journal `expectedSequence` CAS。
- [ ] 将 versioned Acceptance Contract、hash-bound trusted Risk Assessment、Check Result、Reviewer Assignment/Verdict、Sponsor Gate 与 Acceptance Record 纳入正式 Journal schema/projection。
- [ ] Risk Assessment 只能由 Kernel 从可信 Plan/Capability/Artifact/Effect 元数据构造；Workroom Profile 只能加严 baseline matrix，不能降级或让 Executor 自报。
- [ ] Reviewer 使用独立 principal/Assignment 与只读 Reviewer View；强制 producer/reviewer separation of duty，并逐 criterion/claim disposition。
- [ ] Sponsor Gate 绑定 candidate hash、Contract/Policy revision、scope、owner 与 deadline；replacement/target move 自动 stale，超时后仍可 reassign/reopen/rebase/replan/cancel。
- [ ] 区分 Task/Integration `accepted` 与 Effect Intent `authorized`；Effect 的 `committed | failed | outcome_unknown` 只由 Effect Ledger receipt 结算。
- [ ] Project State/Task Memory projector 只消费 Acceptance Record 中明确 accepted claim IDs；拒绝 execution-completed、discussion、投影消息或工具临时 ApprovalPort 成为 Accepted Source。
- [ ] 增加生产级并发/重放/权限/E2E 测试，至少覆盖自验拒绝、伪造风险拒绝、低风险无 Reviewer、高风险 Gate、hash stale、超时恢复、取消与 claim-level memory projection。

Production slice 1 (2026-08-21): 已落地 `WorkroomAcceptancePolicyDecisionPort`、`evaluateTaskAcceptance()` CAS、结构化 low-risk Acceptance Record、unsafe auto-accept baseline 校验和 fail-closed 无端口行为。Port 的 generation/Profile 注册、预先 pinned Contract/Policy catalog、Reviewer/Sponsor flow、Effect authorization 与 accepted-source projector 仍未完成，因此第二项及 P7 整体不勾选。

Production slice 2 (2026-08-21): Task revision 现在必须先追加 `task.acceptance_pinned`，未固定 Contract/Policy 不得 claim；decision 与 replay 都核对 exact pinned snapshot。标准 Agent Host 通过当前 generation Root Scope 的 `workroomAcceptancePolicyDecisionToken` 动态解析 provider，缺失即 fail closed。Profile catalog/publisher 与 Reviewer/Sponsor flow 仍未完成，P7 整体继续保持 `in_progress`。

Production slice 3 (2026-08-21): policy 的 `reviewer_required | reviewer_then_sponsor | sponsor_required` route 不再折叠成通用 blocked reason，而是追加 hash/Contract/Policy-bound `reviewer.assigned` / `sponsor_gate.opened` facts，保存 owner、deadline 与必须包含 reassign/reopen/replan/cancel 的恢复动作；Kernel clock 可确定性过期，fresh evaluation 可重开，返工/取消会关闭当前 open wait。Reviewer claim/verdict、Reviewer→Sponsor 串联与 Sponsor typed decision ingress 尚未接入，P7 保持 `in_progress`。

Production slice 4 (2026-08-21): Reviewer claim/verdict 与 Sponsor decision 已进入 typed Kernel control surface，并由 generation-owned Acceptance Authority 对 exact Project/Run/Task/target/sequence 授权；producer self-review、stale candidate、criterion/claim 缺项与伪造 scope 均 fail closed。Reviewer→Sponsor 串联保留 claim disposition 和双方 principal proof。Risk metadata trust chain、Effect authorization 与 accepted-source memory projector 尚未完成，P7 保持 `in_progress`。

Production slice 5 (2026-08-21): 已新增纯 Accepted Source projector，只接受 persisted Acceptance Record 中明确 accepted claim IDs；Task Memory 摘要不复制 report 自由文本或 rejected claim。State Patch 固定 Project/Run/Plan/Task、base state revision、Kernel source sequence、typed schema digest、fact provenance/validity/精确 supersedes，并拒绝跨 Project/Run、stale sequence 与 schema 外状态。Kernel CAS application、conflict/disputed projection、rebuild/recall 与 Execution Context Release 尚未接入，P7 保持 `in_progress`。

Definition of done: 上述项目全部完成，原型的 scenarios 在正式 Kernel/Host/Journal 路径有等价覆盖，随后删除 throwaway TUI，并在决策地图 #7 标记 production absorbed revision。

## P8：Remote A2A Executor

Status: in_progress
Source: decision map #8 and `packages/im/agent/prototypes/remote-a2a-executor/`

- [ ] 在 Agent/Workroom 层增加 outbound Remote Executor Port；复用标准 Task/Assignment/lease/fence/report events，不恢复 `remote_mesh` 专用 Task 状态机。
- [ ] 定义并发布 versioned Workroom A2A extension、Agent Card capability 与 typed Dispatch/Completion schema；不兼容的 text-only Agent 禁止 claim Workroom Assignment。
- [ ] 增加 Journal-backed Dispatch Outbox、Remote Execution Link、Callback Inbox 和 reconciliation worker；固定 dispatch/message id，支持重启、重复、乱序、gap 与 poll snapshot。
- [ ] callback gateway 固定 endpoint/auth/Card snapshot，并在 Kernel CAS 前校验 assignment/task revision/attempt/fence、remote task identity、event id/hash/sequence 与 completion schema。
- [ ] 实现 GitHub Workspace Provider：canonical repo ID、immutable base/checkpoint SHA、per-attempt branch、path/ref scope、fence、exact head/PR receipt；credential 通过 capability gateway，canonical branch 强制保护。
- [ ] 将 remote push/PR/cancel 等副作用接入 Effect Ledger 与 #7 risk/approval；Remote Completion 只能产生 `assignment.execution_completed`，不得 accept/merge/deploy。
- [ ] lease/cancel/reconcile deadline 全部由 Kernel clock 驱动；takeover 使用更高 fence 和新 branch，late callback/push/PR stale，未知远端结果保持 `outcome_unknown`。
- [ ] 改造或隔离现有 inbound `packages/host/a2a` 的 `InMemoryTaskStore`/running map，避免将协议 Host 误当 Workroom Remote Executor；删除残余 PORTS/docs 中旧 `remote_mesh` 说明。
- [ ] 增加生产 E2E：模拟远端 Agent Card、unknown send、重复/冲突/gap callback、进程重启 recovery、lease race、takeover、cancel timeout、exact PR head、acceptance handoff 与 discussion 不改变状态。

Definition of done: 本地与远程 Executor 对 Kernel 产生同构事件，故障/重启/重复输入下只有一个合法 execution-completed candidate，旧 attempt 永远不能覆盖新 fence；随后删除 #8 throwaway TUI。

Production slice 1 (2026-08-21): 已定义 immutable v1 Remote Dispatch Envelope/Outbox item，固定 dispatch/message identity、Assignment attempt/fence、endpoint/Card、Context/Contract/Capability/Disclosure refs 与 GitHub immutable workspace scope；generation-owned Remote Executor Port 仅返回 transport observation，retry 必须复用持久化 identity/digest。Journal-backed worker、callback/reconciliation 与 Kernel completion handoff 尚未完成，P8 保持 `in_progress`。

Production slice 2 (2026-08-21): 已新增 crash-durable Remote Dispatch Outbox Repository，Memory/File adapters 共用 CAS/重放契约；File append 使用 file+directory fsync 与 hard-link CAS，固定 payload-sensitive event identity，支持 lease/fence、过期接管、旧 worker fencing、restart/corruption fail-closed。`outcome_unknown` 只进入 `reconcile_required`，不产生 Task terminal。Outbox worker、Remote Execution Link、Callback Inbox 与 Kernel completion handoff 尚未接入，P8 保持 `in_progress`。

Production slice 3 (2026-08-21): 已新增 durable Outbox worker，按 persisted Envelope 执行 claim/recover/dispatch；未知发送结果持久化为 content-free `outcome_unknown` 并停在 reconciliation，重启后禁止盲重发，非合作 transport 可取消。Callback Inbox、poll reconciliation、Remote Execution Link 与 Kernel completion handoff 尚未接入，P8 保持 `in_progress`。

Production slice 4 (2026-08-21): 已新增 crash-durable Remote Callback Inbox 与 Remote Execution Link；可信 Gateway receipt 与远端正文分离，固定 endpoint/Card/auth、dispatch/message、Task/Assignment revision、attempt/fence、remote identity 与 Git workspace receipt。endpoint+event id 的 exact callback 重放 no-op、drift fail closed；有界 gap 只能按 sequence reconciliation 释放。typed Completion 只投影为本地 Assignment observation，再经唯一 Kernel CAS 进入 `assignment.execution_completed`，不会直接 accept Task。poll reconciliation worker、Effect Ledger、Git capability gateway/branch protection 与 Host A2A E2E 尚未接入，P8 保持 `in_progress`。

Production slice 5 (2026-08-21): 已新增单次、可重启的 Remote Callback poll reconciliation worker；只在 durable Inbox 为 `reconcile_required` 时以 exact Link/cursor 发起 poll，验证 endpoint/Card/auth、trusted poll time、完整 callback/Gateway receipt 与 canonical batch digest，再交给 Inbox CAS 收敛。deadline、noop、lost-response replay 与非合作 poll cancel 均为 typed/fail-closed，worker 不写 Task/Kernel。Host 仍缺 endpoint-specific auth registry、dispatch 后 Link 预注册/可枚举恢复、完整 Envelope 恢复与 accepted observation→Kernel application service，因此不得把普通 inbound A2A Turn 当作 Workroom callback；P8 保持 `in_progress`。

## P9：Legacy Multi-Agent Cutover

Status: in_progress
Source: decision map #9

- [x] 删除旧 `OrchestrationService/Kernel`、mutable repositories、`AgentDispatcher`、five-agent executing strategy、`remote_mesh` registry/poller、旧数据库 models 与旧 Console route；增加 major changeset 和 `check:workroom-ssot` 基础门禁。
- [x] 从 `spawn_task` 移除 `run_id/task_id`、Session→Run 隐式创建、remote dispatch 与 Workroom terminal 回写；普通 chat 子任务不再伪装成 durable Workroom Task。
- [ ] 在 Space Router/Context View/Tool Snapshot 层物理隔离工具：chat 可见 `spawn_task` 但不可见 Workroom command；Workroom Orchestrator/Executor/Reviewer 不可见 `spawn_task`，也不能通过 deferred discovery 重新加载。
- [x] 删除 `zhin.js/agent` 会立即执行 `AIService.runAgent` 的 `runPipeline/runParallel/route`；普通一次性调用迁移到 `AIService.runAgent`，不保留同名兼容 wrapper。
- [ ] 如需构图便利层，以不同名称提供纯 `WorkflowPlanBuilder`，只返回 versioned Plan proposal，不执行或保存状态。
- [ ] 将资源 registry 的公开 `AgentOrchestrator` 名称收敛为 `AgentResourceHub`（最终命名可等价），并从 prompt、类型、日志、docs 中保证 `Orchestrator` 只表示 Workroom role。
- [ ] 用 role-scoped command ports/tools 替代通用 `workroom_transition`：身份与 Project/Run/Task/Assignment scope 从可信 Envelope 注入；模型不可调用 claim、clock、lease recovery、acceptance projector 或替其他 Assignment 上报。
- [x] 增加正式 `AssignmentExecutorPort`、Local adapter 与 durable dispatch worker；只复用 `SubagentRuntime` 的模型执行能力，不复用 `SubagentSystem` 的进程内 task identity/status/result delivery。
- [ ] 增加 legacy config/import tombstone：`ai.remoteAgents`、`remote_mesh`、旧 orchestration tools/exports/route 在启动或编译时明确失败并指向迁移文档，禁止 silent ignore、alias、fallback 或双写。
- [ ] 提供旧 Run 的离线只读 export/audit；active 旧 Run 进入 `migration_required`，只能 export/cancel/replan。旧 `completed` 不自动升级为 accepted；导入内容只能成为带 provenance 的 untrusted Inbox/Evidence candidate。
- [x] 清理 `packages/im/agent/README.md`、`packages/im/zhin/README.md`、full-bot/multi-agent-room 中旧 pipeline/remote mesh/OrchestrationKernel 叙述，并补充中英文 breaking migration matrix。
- [ ] 更新并锁定 API snapshot/config tombstone 与剩余 generated docs，防止旧执行 API 再次导出。
- [ ] 扩展门禁与 E2E：禁止旧生产符号和第二 writer；验证 chat spawn 零 Workroom event、Workroom capability snapshot 无 spawn、Plan builder 无 I/O、local/remote 同构事件、legacy completion 不进入 Project State。

Definition of done: 一个进程、一个 Project、一个 Run 只有 Workroom Journal 一个状态写入权威；任一旧 API/config/data 都只能明确失败或进入离线迁移路径，不能在后台继续执行。Local/Remote Executor、Scheduler、Agent 角色、Console/IM 投影均只通过新版 Kernel 契约协作，随后才可标记 #9 production absorbed。

Production slice 1 (2026-08-21): 已新增 persistent、I/O-free `WorkflowPlanBuilder`，只输出 deterministic v1 DAG proposal/digest，验证缺失依赖与 cycle，不接收 `AIService`、不执行 Agent、不写 Journal。待 Plan Revision admission、Space/Tool 隔离和 role-scoped ports 完成后再勾选条目，P9 保持 `in_progress`。

Production slice 2 (2026-08-21): 已新增正式 `AssignmentExecutorPort` 与 caller-owned `executeAssignment()`；immutable Envelope 固定 Project/Run/Task/Assignment attempt/fence、executor/integration role、Agent Definition、Plan、Context Policy、fact anchor、Capability/Policy Snapshot 与 Workspace Lease。Executor 只能产生 typed progress/heartbeat/checkpoint/execution-completed observation，不能 claim/clock/accept/replan/cancel；AbortSignal race 可终止不合作的 pending iterator。Local adapter、durable dispatch worker 与 observation→Kernel CAS adapter 尚未接入，P9 保持 `in_progress`。

Production slice 3 (2026-08-21): 已新增 `LocalAssignmentExecutor`，仅从 generation-owned model execution port 投影 progress/heartbeat/checkpoint/execution-completed，固定 Envelope digest 与唯一 event identity；completion 原子缓冲，重复/越权/终态后事件 fail closed，取消不依赖模型合作。observation→Kernel CAS adapter 与 Space/Tool Snapshot 隔离仍未接入，P9 保持 `in_progress`。

Production slice 4 (2026-08-21): 已新增 `AssignmentObservationIngress`，Local/Remote observations 统一校验 Project/Run/Task revision、Assignment revision/attempt/fence/Envelope digest，并通过 `WorkroomKernel` 的 Journal `expectedSequence` CAS 追加 progress/heartbeat/checkpoint/execution-completed。heartbeat lease 只由可信 Kernel clock/policy 续期；重复 observation exact no-op、payload drift fail closed；旧公共 `heartbeat`/`complete_execution` command 已删除。Space Router/Tool Snapshot 物理隔离、剩余 role-scoped control ports 与 legacy tombstone/migration 仍未完成，P9 保持 `in_progress`。

Production slice 5 (2026-08-21): 已新增以 canonical `ConversationRef/conversationRefKey` 为唯一地址 SSOT 的 Interaction Space Router 与 crash-durable File Binding Repository；binding revision + `effectiveAfterConversationSequence` 在重启、重复与并发 CAS 下稳定，任何不严格晚于当前 anchor 的延迟/replay 入站都返回 typed ignored，已绑定地址缺 sequence 时 fail closed。另新增两阶段签发的 Role Capability Snapshot：精确交集 generation/Profile/Agent Definition/role/Task/policy，内容摘要与 Assignment Envelope ref/revision/digest 对齐；每次 deferred discover/load 都重新要求可信 Envelope，Workroom executor/integration 永久拒绝 `spawn_task`、跨角色命令与自签越权加载。尚未接入正常 ingress/deferred catalog，binding authority 也必须由可信 Project registry + 当前 conversation barrier 签发，不能由调用方自填 anchor；因此本条物理隔离仍不勾选，P9 保持 `in_progress`。

## P10：Domain Workroom Profile

Status: in_progress
Source: decision map #10 and `packages/im/agent/prototypes/workroom-profile/`

- [ ] 增加 Project-scoped Profile Registry：Profile Revision 精确绑定 Project Charter revision、Pack `id/version/digest`、Profile Overlay、parent/source/decision，并以 CAS 激活 active pointer。
- [ ] 定义四类 immutable Capability Pack manifest/publisher（domain/competency/integration/policy），接入 generation snapshot；同 id/version digest 变化、dependency digest 不符和 canonical capability 冲突均 fail closed。
- [ ] 实现纯 Profile compiler，输出 compiled digest、Agent/Workflow/Memory/Glossary/policy projection 与完整 diagnostics；required Workflow capability/Agent requirement 不满足时禁止激活。
- [ ] 复用现有 generation Tool/Skill/Agent catalog 作为 available supply；禁止新建第二套 mutable registry，禁止 Pack/Profile selection 绕过 capability owner/generation lease。
- [ ] 实现 Assignment Capability Snapshot projector：`generation ∩ Profile ∩ Agent ceiling ∩ Task closure ∩ policy`，包括 Skill prerequisite/required Tool closure；缺项形成 Capability Request/Blocker。
- [ ] 定义 typed Workflow Strategy requirement/parameter schema，并确保 Strategy 只生成 Plan proposal；authority、risk、acceptance 与 disclosure 字段不得藏入自由参数或 prompt。
- [ ] 实现 Profile Curator/Proposal governance，只接受 Acceptance Record、accepted Task Memory、Sponsor Decision 或受信 Pack publication；discussion、compaction、execution-completed 与模型 metadata 不得成为 Profile source。
- [ ] 实现语义 diff policy：Charter、schema migration、Pack supply、Tool、external Integration、authority、auto-acceptance expansion 与 policy relaxation 必须 Sponsor；非扩权 accepted knowledge/work-method change 才可 policy activation。
- [ ] Run 固定 Profile revision/digest，Assignment 固定 Capability/Policy snapshot；Profile/HMR 更新只影响新 Run，in-flight rebase 必须显式并使旧 Assignment/Gate 正确 stale。
- [ ] rollback 以新 Revision 恢复旧 composition，并重新经过语义 diff；不删除历史、不改 Run pin、不冒充外部 Effect compensation。
- [ ] 增加 Project-local Overlay → shared Pack candidate 的独立发布治理，保留 accepted provenance、owner/check/review；其他 Project 必须显式采用新 Pack revision。
- [ ] 将软件研发、内容制作至少两个异构 fixture 提升为生产 E2E，并补投资研究/家庭管理或客户支持中的至少一个高敏领域，验证 Pack 复用、Project 隔离、最小装载、冲突、HMR、rollback 与权限扩张拒绝。

Definition of done: 相同 Kernel 可从不同 exact Profile Revision 构造领域正确且最小授权的 Run/Assignment；任何 Project 学习都不能污染共享 Pack，任何能力/权限/验收放宽都不能由 Agent 自授权，在重启/HMR/replay/rollback 后 Profile digest、Run pin 与治理结论保持一致，随后删除 #10 throwaway TUI。

Production slice 1 (2026-08-21): 已新增纯 Profile compiler，固定 exact Pack refs 和 generation supply，输出 deterministic frozen capability/workflow projection 与 digest；Pack/dependency digest、canonical conflict、Skill→Tool→Agent closure、required Workflow 缺口均 fail closed。Registry/Overlay/Memory/Glossary/policy/governance/Run pin 尚未完成，P10 保持 `in_progress`。

Production slice 2 (2026-08-21): 已新增 Project Profile Registry 领域契约，immutable Revision 固定 Project/Charter/Pack/Overlay/source/parent/compiler output，通过 Journal revision CAS 激活 active pointer；rollback 必须新 Revision，Run pin 永不随 active 漂移。写入前由可信 Governance Port 对 exact current composition 与 semantic diff 授权；bootstrap、Tool/Skill/Agent/Workflow/Charter/Overlay 扩张及 Pack/Policy 变化强制 Sponsor，并在 replay/activation 复验。Durable Registry adapter、generation token/provider、Overlay/Memory/Glossary/policy projection 与异构 E2E 尚未接入，P10 保持 `in_progress`。

Production slice 3 (2026-08-21): 已新增 crash-durable File Profile Journal adapter；immutable segment、hard-link first-sequence CAS、canonical payload digest、contiguous/domain replay 与 file/leaf/parent fsync 共同保证多实例、重启和损坏时 fail closed。generation token/provider、Overlay/Memory/Glossary projection 与异构 E2E 尚未接入，P10 保持 `in_progress`。

## P11：Cross-Project Portfolio Admission

Status: in_progress
Source: decision map #11 and `packages/im/agent/prototypes/portfolio-admission/`

- [ ] 增加独立 Portfolio Journal/Repository 与 `append(expectedSequence)` CAS；它只保存 Project 资源政策、opaque request、grant/reclaim/usage facts，禁止复用 Workroom Journal writer 或引入 Task/Plan/Context 字段。
- [ ] 定义 Workroom Scheduler → Portfolio 的 `CapacityRequestPort`：可信注入 Project scope、Run/Profile/scheduler revision，限制 outstanding heads，运行时和 schema 双重拒绝 prompt/message/title/Memory/Artifact/Evidence/Tool args。
- [ ] 定义 generation-owned Resource Pool/price/rate catalog 与原子 Resource Bundle validator；模型、Executor、sandbox 和 rate reservation 要么整包成功要么全不占用，并校验 Project Profile/allowed pool ceiling。
- [ ] 实现 Project/global 两级 Budget Account：grant 前 worst-case reservation，offer expiry refund，可信 Usage Receipt settlement，overrun 如实记账，`usage_unknown` 保留 reservation 并进入 reconciliation blocker；禁止 lost/abort 自动算零或盲目重试。
- [ ] 实现可重放 admission decision：starvation reservation → Sponsor Portfolio lane → weighted dominant historical service → deadline → sequence/id；限制 Project concurrency/outstanding/burst，并用显式 normalization event 管理长期计数。
- [ ] 定义 versioned Sponsor Portfolio Policy/command surface：Project lane、weight、budget allocation、allowed pools、caps、pause/resume 与 exact-request bounded Priority Override；所有 target/principal/revision 可信注入，消息 metadata/Agent 不能自授权。
- [ ] 实现 fenced Capacity Grant lease：固定 Resource Bundle、budget/rate reservation、Portfolio/Project policy revisions、offer/lease TTL；Workroom Kernel 消费时绑定 Assignment attempt，旧/重复/过期 fence fail closed。
- [ ] 实现两阶段 Capacity Reclaim：Portfolio 只能通过 outbox 请求 owning Workroom checkpoint/release；atomic 工作不可抢占，checkpointable ack 后才释放；暂停不直接 cancel Task，真正 cancel 继续走 Workroom Control Plane。
- [ ] 增加 durable grant/reclaim outbox、idempotent consumer、Kernel clock、lease heartbeat/max quantum 与 reconciliation worker；存在 starvation/reclaim reservation 时禁止无限 renewal，重启/HMR 不改变旧 policy snapshot。
- [ ] 将现有 Schedule Promise queue、per-user `RateLimiter` 与 per-execution `BudgetGuard` 明确保留在各自执行域；只能作为 enforcement/usage adapter，不得成为 Portfolio SSOT 或第二个 Workroom Scheduler。
- [ ] 增加 Sponsor Room/Console projection，展示各 Project 当前 lane、队列 head、grant/reclaim、预算/rate、阻塞与公平性指标；projection 只能发 typed Portfolio command，discussion 不改变准入状态。
- [ ] 增加多 Project 生产 E2E：跨模型+Executor 原子 bundle、并发 CAS、2:1 share、持续 urgent 下 low 获得机会、budget exhaustion/transfer、pause/resume、checkpoint/atomic reclaim、offer/lease expiry、unknown usage/late receipt、outbox duplicate/restart 与 Project memory 零泄漏。

Definition of done: 任意 Project 只能通过其 Workroom Scheduler 的 opaque head 获得资源，Portfolio 在多实例、重启、持续高优先级流量与 unknown provider outcome 下仍保持预算、fence、公平性和 Project 隔离；它不能产生任何 Task/Run 状态事件，正式路径具备等价覆盖后删除 #11 throwaway TUI。

Production slice 1 (2026-08-21): 已新增 generation-owned Resource Pool Catalog 与原子 Resource Bundle validator；exact tenant/Project/Profile/catalog binding、catalog/Profile 双重 ceiling、model+Executor 全有或全无、region/trust/compatibility、rate 与 worst-case usage/cost 均 fail closed。Budget Account、fair admission、Grant/Reclaim、durable outbox 与 projection 尚未接入，P11 保持 `in_progress`。

## P12：Data Classification, Retention and Disclosure

Status: in_progress
Source: decision map #12 and `packages/im/agent/prototypes/data-governance/`

- [ ] 定义 production Data Descriptor/Category Registry：tenant/Project、kind、confidentiality、category、purpose、subject linkage、region、retention、lineage、transform/policy revision；unknown/malformed 输入进入 quarantine，Agent/metadata 不能降低 trusted floor。
- [ ] 重构 Workroom Fact/Journal/Artifact/Evidence schema：不可变 Journal 只保存 content-free header/hash/ref/provenance，不保存受 retention/erasure 管理的正文；提供迁移扫描，标记旧 Journal 中无法安全治理的 embedded payload。
- [ ] 增加加密 Payload Vault interface 与至少 database/object-store adapters：per-object/chunk key、location manifest、tenant/Project partition、region enforcement、content hash、read audit、primary/index/cache/replica/backup 生命周期。
- [ ] 实现唯一 Data Governance Policy module：Context View、Evidence Port、Workroom/Sponsor projection、Console、model provider 与 A2A 全部调用同一 disclosure interface/reason codes；门禁禁止 sink adapter 自写更弱的 bypass/filter。
- [ ] 定义 generation-owned Processing Destination contract：owner/endpoint、tenant/Project/trust domain/digest、region、classification/category ceiling、training/logging/retention、recipient membership revision、deletion/re-disclosure support；unknown contract fail closed。
- [ ] 将 Context View Builder 改为针对 exact model destination 逐 Fact 判定并记录 manifest；Evidence index 自身也判定，正文每次下钻重授权；mandatory fact 被 policy deny 时阻止 Assignment，不用 token 裁剪掩盖。
- [ ] 将 Projection Outbox/A2A Dispatch 接入 materialized Disclosure Manifest：先运行 typed trusted transform、固定 output hash/recipient/purpose/policy/approval，再持久化 Effect Intent 并发送；opaque `disclosureManifestRef`、文本前缀 redaction 和发送后补审计全部禁止。
- [ ] 实现派生传播与 cache invalidation：Digest/summary/Report/Artifact/hand-off 取 source confidentiality/category/subject/region/purpose/retention 的保守 join/intersection；source hash、policy、安全 revocation 或 membership 改变时旧 View/Digest/approval/outbox stale。
- [ ] 实现 Trusted Transform Registry/Runner/Verifier：typed field/span/chunk manifest、input/output hash、版本、适用 channel、classification/category/subject-link result；pseudonymization 不去除 personal linkage，LLM/remote producer 不能自签 deidentification。
- [ ] 实现 baseline + Profile governance compiler：Profile 只能提高 floor、收窄 destination/region/purpose/channel、交叉 retention window、增加 approval/hold 并选择受信 transform；tenant/credential/unknown/residency/no-training hard deny 不可配置放宽。
- [ ] 实现 durable Lifecycle/Purge control plane：Kernel clock、minimum/maximum、Retention Hold owner/review/release、subject erasure、multi-location purge outbox、authenticated receipt、outcome_unknown reconciliation、crypto erase 与 content-free tombstone。
- [ ] 将 processor deletion/recall 建模为独立 Effect，记录 irreversible/unsupported/unknown external copies；Retention 不直接改 accepted Project State，Evidence 消失只产生 lifecycle fact，由 Memory/Acceptance policy 判定 stale/rework。
- [ ] 增加 Data Steward/Privacy/Compliance role-scoped command ports与 Sponsor/Console projection；approval/hold/erasure/export 均绑定 exact scope/digest/deadline，普通 discussion、Agent、Sponsor metadata 不得直接产生治理终态。
- [ ] 增加客户支持与投资研究生产 E2E：PII/credential/financial/market-sensitive 分类、quarantine、model/IM/Console/A2A 一致判定、membership/region/tenant/no-training hard deny、exact approval、masking仍可关联、policy revocation、Hold overdue、minimum retention、erasure、多副本 purge/unknown receipt、重启 replay 与零正文 Journal。

Production slice 1 (2026-08-21): 已新增 unknown-safe Data Descriptor classifier 与唯一 pure disclosure decision boundary；trusted kind/category floor、canonical descriptor、exact policy/channel/purpose/principal/destination/recipient binding，以及 tenant/Project/credential/residency/no-training hard deny均已覆盖。transform/approval 输出固定 exact digest/revision/expiry。Payload Vault、Journal 正文拆分、destination registry、materialized manifest/outbox 与 lifecycle/purge 尚未完成，P12 保持 `in_progress`。

Production slice 2 (2026-08-21): 已新增 Payload Vault/Trusted Transform ports 与 content-free materialized Disclosure Manifest；发送前重验 exact Descriptor、Destination、recipient、Policy、approval 与 source/output hash，metadata-only 不读取正文，transform 输出重新绑定 lineage/subject，Destination/Policy digest 与 canonical 内容强绑定。加密 Vault adapter、Projection/A2A outbox 接线、派生失效与 retention/purge control plane 尚未完成，P12 保持 `in_progress`。

Definition of done: 任意正文从 ingress 到 model、Agent hand-off、群投影、Console、Evidence 和 A2A 都能由同一 Descriptor/source lineage 与当前 policy 解释“为何可见”；任意到期/erasure 对每个 payload location 有 confirmed 或 explicit unknown receipt，Journal 无需删除历史也不残留受治理正文。正式路径覆盖后删除 #12 throwaway TUI；届时 #1–#12 决策阶段整体进入 production absorption。
